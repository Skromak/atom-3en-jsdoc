'use babel';

import * as parser from 'babylon';
import traverse from 'babel-traverse';

const DEFAULT_PARAM_NAME = 'Unknown';
/* eslint-disable no-use-before-define */
const PARAM_PARSERS = {
  Identifier: parseIdentifierParam,
  AssignmentPattern: parseAssignmentParam,
  RestElement: parseRestParam,
  ObjectPattern: parseDestructuredParam,
};
/* eslint-enable */

/**
 * getAST - Turns the code to the ast.
 *
 * @param {string} code The file containing the code
 *
 * @return {object} AST
 */
function getAST(code) {
  const PARSE_OPTS = { locations: true, sourceType: 'module' };
  const ast = parser.parse(code, PARSE_OPTS);
  return ast;
}

/**
 * onLine - Is the node on or one below the line?
 *
 * @param {object} node    AST node
 * @param {number} lineNum Line number to check the node against
 *
 * @return {boolean} Is the node on or below the line?
 */
function onLine(node, lineNum) {
  const startLine = node.loc.start.line;
  return startLine === lineNum || startLine - 1 === lineNum;
}

/**
 * getNode - Get the function node at the line number from the ast
 *
 * @param {object} ast     AST representing the file
 * @param {number} lineNum Line number to check the node against
 *
 * @return {object} AST function node
 */
function getNode(ast, lineNum) {
  let node = null;
  let exported = null;
  traverse(ast, {
    FunctionDeclaration: (declaration) => {
      const n = declaration.node;
      if (onLine(n, lineNum)) {
        node = n;
        if (exported && exported.declaration === node) {
          node.loc = exported.loc;
        }
      }
    },
    VariableDeclaration: (declaration) => {
      const n = declaration.node;
      const declarator = n.declarations[0];
      if (onLine(n, lineNum) && declarator.type === 'VariableDeclarator') {
        const declaredNode = declarator.init;
        if (declaredNode.type === 'FunctionExpression') {
          node = declaredNode;
          node.loc = n.loc;
          node.id = { name: declarator.id.name };
        }
      }
    },
    'ExportNamedDeclaration|ExportDefaultDeclaration': (declaration) => {
      exported = declaration.node;
    },
    AssignmentExpression: (declaration) => {
      const n = declaration.node;
      if (onLine(n, lineNum) && n.left.type === 'MemberExpression'
        && n.right.type === 'FunctionExpression') {
        node = n.right;
        node.loc = n.loc;
        node.id = { name: n.left.property.name };
      }
    },
  });
  return node;
}

/**
 * parseIdentifierParam - Parse an indentifier param to an array of parameters
 *
 * @param {object} param AST indentifier param
 *
 * @return {array} List of parameters
 */
function parseIdentifierParam(param) {
  return [{ name: param.name }];
}

/**
 * parseAssignmentParam - Parse an assignment parameter to an array of
 * parameters
 *
 * @param {object} param AST representation of an assignment parameter
 *
 * @return {array} Array of simple parameters
 */
function parseAssignmentParam(param) {
  let type;
  let defaultValue;

  const paramAssignmentType = param.right.type;

  if (paramAssignmentType === 'StringLiteral') {
    type = 'string';
    defaultValue = param.right.value;
  } else if (paramAssignmentType === 'NumericLiteral') {
    type = 'number';
    defaultValue = param.right.value;
  } else if (paramAssignmentType === 'ArrayExpression') {
    type = 'array';
    defaultValue = '[]';
  } else if (paramAssignmentType === 'ObjectExpression') {
    type = 'object';
    defaultValue = '{}';
  } else {
    throw('Unknown param type: ', paramAssignmentType);
  }

  return [{ name: param.left.name, defaultValue, type }];
}

/**
 * parseRestParam - Turn a rest parameter to an array of simplified parameters
 *
 * @param {object} param AST representation of a rest parameter
 *
 * @return {array} Array of simplified parameters
 */
function parseRestParam(param) {
  return [{ name: param.argument.name, type: 'array' }];
}

/**
 * getParamParser - Get the parameter parser for the type
 *
 * @param {string} paramType AST parameter node type
 *
 * @return {function} Function that returns an array of simplified parameters
 * from that parameter node type.
 */
function getParamParser(paramType) {
  const pp = PARAM_PARSERS[paramType];
  if (!pp) {
    throw new Error(`Unknown param type: ${paramType}`);
  }
  return pp;
}

/**
 * parseDestructuredParam - Turn destrucutured parameters to a list of
 * simplified parameters
 *
 * @param {object} param AST representation of a destructured node parameter
 *
 * @return {array} List of simplified parameters
 */
function parseDestructuredParam(param) {
  const props = param.properties;
  const parent = DEFAULT_PARAM_NAME;

  return props
    .reduce((params, { value }) => {
      const pp = getParamParser(value.type);
      const newParams = pp(value).map((p) => Object.assign({}, p, { parent }));
      return params.concat(newParams);
    }, [{ name: parent, type: 'object' }]);
}

/**
 * simplifyParams - Take a list of parameters and return a list of simplified
 * parameters to represent them for JS Doc.
 *
 * @param {array} params List of AST reperesentation of parameters.
 *
 * @return {array} List of simplified parameters representation the AST
 * parameters.
 */
function simplifyParams(params) {
  return params.reduce((col, param) => {
    const pp = getParamParser(param.type);
    return col.concat(pp(param));
  }, []);
}

/**
 * simplifyLocation - Take the node location and return just a line and column.
 * This is intended to represent where the JSDoc will be output (i.e. one line
 * above the function)
 *
 * @param {object} location AST function node location
 *
 * @return {object} Location AST doc should be output.
 */
function simplifyLocation(location) {
  return {
    line: Math.max(location.start.line - 1, 1),
    column: location.start.column,
  };
}

/**
 * simplifyNode - Take the AST representation of the function node and simplifyNode
 * it to get just the information we need for generating a JS Doc.
 *
 * @param {object} node AST representation of the function node.
 *
 * @return {object} Simplified representation of the function node.
 */
function simplifyNode(node) {
  return {
    name: node.id.name,
    location: simplifyLocation(node.loc),
    params: simplifyParams(node.params),
    returns: { returns: false },
  };
}

/**
 * parse - Take code and a line number and return an object representing all
 * properties of the function.
 *
 * @param {string} code        Complete file
 * @param {number} [lineNum=1] Line number where the cursor is located and where
 * we will look for the function to create the object for.
 *
 * @return {object} Simplified object representing the function.
 */
export function parse(code, lineNum = 1) {
  const ast = getAST(code);
  const node = getNode(ast, lineNum);
  if (!node) {
    return null;
  }
  const simplified = simplifyNode(node);
  return simplified;
}