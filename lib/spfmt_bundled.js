(function(){function r(e,n,t){function o(i,f){if(!n[i]){if(!e[i]){var c="function"==typeof require&&require;if(!f&&c)return c(i,!0);if(u)return u(i,!0);var a=new Error("Cannot find module '"+i+"'");throw a.code="MODULE_NOT_FOUND",a}var p=n[i]={exports:{}};e[i][0].call(p.exports,function(r){var n=e[i][1][r];return o(n||r)},p,p.exports,r,e,n,t)}return n[i].exports}for(var u="function"==typeof require&&require,i=0;i<t.length;i++)o(t[i]);return o}return r})()({1:[function(require,module,exports){
var Output;
var CommentsList;
var currentIndent;
indentUnit = '  ';

exports.format = (syntaxTree, indentDepth = 2) => {
  indentUnit = ' '.repeat(indentDepth);

  Output = [];
  CommentsList = syntaxTree.commentsList;
  currentIndent = '';

  if (syntaxTree.header) {
    addLine(syntaxTree.header);
  }
  addPrologue(syntaxTree.prologue);

  syntaxTree.functions.forEach(addFunction);

  addQuery(syntaxTree.body);
  if (syntaxTree.inlineData) {
    addInlineData(syntaxTree.inlineData);
  }

  addComments();

  return Output.join('\n');
};

/// Local functions //////////////////////////////////////////

debugPrint = (object) => {
  console.log(JSON.stringify(object, undefined, 2));
};

increaseIndent = (depth = 1) => {
  currentIndent += indentUnit.repeat(depth);
};

decreaseIndent = (depth = 1) => {
  currentIndent = currentIndent.substr(0, currentIndent.length - indentUnit.length * depth);
};

addLine = (lineText, commentPtr = 0) => {
  // 0 means min ptr: no comments will be added.
  addComments(commentPtr);
  Output.push(currentIndent + lineText);
}

addComments = (commentPtr = -1) => {
  // -1 means 'max' ptr: all comments will be added.
  var added = false;
  while (CommentsList.length > 0 && (CommentsList[0].line < commentPtr || commentPtr == -1)) {
    var comment = CommentsList[0].text;
    if (commentPtr == -1) {
      Output.push(comment);
    } else if (Output[Output.length-1] === '') {
      Output.push(comment);
    } else if (added) {
      Output.push(comment);
    } else {
      Output[Output.length-1] += ' ' + comment;
    }
    CommentsList.shift();
    added = true;
  }
}

addPrologue = (prologue) => {
  // TODO: handle base
  prologue.prefixes.forEach((prefix) => {
    addLine(`PREFIX ${prefix.prefix||""}: <${prefix.local}>`, prefix.location.end.line);
  });
  if(prologue.prefixes.length > 0) {
    addLine("", prologue.prefixes[prologue.prefixes.length - 1].location.end.line + 1);
  }
};

addQuery = (query) => {
  switch (query.kind) {
    case 'select':
    addSelect(query);
  }
};

addSelect = (select) => {
  var selectClause = 'SELECT ';
  if (select.modifier) {
    selectClause += `${select.modifier.toString()} `;
  }
  var projection = select.projection.map(getProjection).join(' ');
  selectClause += projection;
  var lastLine = !select.projection[0].value ?
      select.projection[0].location.start.line :
      select.projection[0].value.location.start.line;
  addLine(selectClause, lastLine);

  addLine('WHERE {', lastLine + 1);
  addGroupGraphPattern(select.pattern);
  addLine('}', select.pattern.location.end.line);

  if (select.order) {
    addLine('ORDER BY ' + getOrderConditions(select.order));
  }
  if(select.limit) {
    // addLine(`LIMIT ${select.limit}`, select.location.end.line);
    addLine(`LIMIT ${select.limit}`);
  }
};

addGroupGraphPattern = (pattern) => {
  increaseIndent();
  pattern.patterns.forEach(addPattern);
  pattern.filters.forEach(addFilter);
  decreaseIndent();
};

addPattern = (pattern) => {
  switch (pattern.token) {
    case 'graphunionpattern':
      addLine('{');
      addGroupGraphPattern(pattern.value[0]);
      addLine('}');
      addLine('UNION');
      addLine('{');
      addGroupGraphPattern(pattern.value[1]);
      addLine('}');
      break;
    case 'optionalgraphpattern':
      addLine('OPTIONAL {');
      addGroupGraphPattern(pattern.value);
      addLine('}');
      break;
    case 'basicgraphpattern':
      pattern.triplesContext.forEach(addTriple);
      break;
    case 'inlineData':
      addInlineData(pattern);
      break;
    case 'inlineDataFull':
      addInlineData(pattern);
      break;
    case 'expression':
      if (pattern.expressionType === 'functioncall') {
        var name = getUri(pattern.iriref);
        var args = pattern.args.map(getExpression).join(", ");
        addLine(`${name}(${args})`);
      } else {
        debugPrint(pattern);
      }
      break;
    default:
      debugPrint(pattern);
  }
};

getOrderConditions = (conditions) => {
  var orderConditions = [];

  conditions.forEach(condition => {
    var oc = getVar(condition.expression.value);
    if (condition.direction == 'DESC') {
      orderConditions.push(`DESC(${oc})`);
    } else {
      orderConditions.push(oc);
    }
  });

  return orderConditions.join(" ");
};

getProjection = (projection) => {
  switch(projection.kind) {
    case '*':
      return '*';
    case 'var':
      return '?' + projection.value.value;
    case 'aliased':
      // TODO:
    default:
      throw new Error('unknown projection.kind: ' + projection.kind);
  }
};

addFilter = (filter) => {
  if (filter.value.expressionType == "relationalexpression") {
    var op = filter.value.operator;
    var op1 = getExpression(filter.value.op1);
    var op2 = getExpression(filter.value.op2);
    addLine(`FILTER (${op1} ${op} ${op2})`);
  }
}

addFunction = (func) => {
  var name = getUri(func.header.iriref);
  var args = func.header.args.map(getExpression).join(", ");
  addLine(`${name}(${args}) {`);
  addGroupGraphPattern(func.body);
  addLine('}');
  addLine('');
};

addTriple = (triple) => {
  var s = getTripleElem(triple.subject);
  var p = getTripleElem(triple.predicate);
  var o = getTripleElem(triple.object);
  addLine(`${s} ${p} ${o} .`, triple.object.location.end.line);
};

getExpression = (expr) => {
  switch (expr.expressionType) {
    case 'atomic':
      return(getTripleElem(expr.value));
    case 'irireforfunction':
      return(getUri(expr.iriref)); // how about function?
    case 'builtincall':
      return(expr.builtincall + '(' + expr.args.map(getExpression).join(', ') + ')');
  }
}

addInlineData = (inline) => {
  switch (inline.token) {
    case 'inlineData':
      var vals = inline.values.map(getTripleElem).join(' ');
      addLine(`VALUES ${getTripleElem(inline.var)} { ${vals} }`);
      break;
    case 'inlineDataFull':
      var vars = inline.variables.map(getVar).join(' ');
      var vals = inline.values.map(getTuple).join(' ')
      addLine(`VALUES (${vars}) { ${vals} }`)
      break;
  }
};

getTuple = (tuple) => {
  return '(' + tuple.map(getTripleElem).join(' ') + ')';
};

getTripleElem = (elem) => {
  switch(elem.token) {
    case 'uri':
      return(getUri(elem));
    case 'var':
      return(getVar(elem));
    case 'literal':
      var txt = `"${elem.value}"`;
      if (elem.lang) {
        txt += `@${elem.lang}`
      }
      return txt;
    case 'path':
      return elem.value.map(v => getUri(v.value)).join('/');
    case 'blank':
      return '[]';
    default:
      debugPrint(elem);
  }
};

getUri = (uri) => {
  if (uri.prefix && uri.suffix) {
    return `${uri.prefix}:${uri.suffix}`;
  } else if (uri.value === 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type') {
    return 'a';
  } else {
    return `<${uri.value}>`;
  }
}

getVar = (variable) => {
  if (variable.prefix === '?') {
    return '?' + variable.value;
  } else if (variable.prefix === '$') {
    return '$' + variable.value;
  } else {
    return '{{' + variable.value + '}}';
  }
}

},{}],2:[function(require,module,exports){
/*
 * Generated by PEG.js 0.10.0.
 *
 * http://pegjs.org/
 */

"use strict";

function peg$subclass(child, parent) {
  function ctor() { this.constructor = child; }
  ctor.prototype = parent.prototype;
  child.prototype = new ctor();
}

function peg$SyntaxError(message, expected, found, location) {
  this.message  = message;
  this.expected = expected;
  this.found    = found;
  this.location = location;
  this.name     = "SyntaxError";

  if (typeof Error.captureStackTrace === "function") {
    Error.captureStackTrace(this, peg$SyntaxError);
  }
}

peg$subclass(peg$SyntaxError, Error);

peg$SyntaxError.buildMessage = function(expected, found) {
  var DESCRIBE_EXPECTATION_FNS = {
        literal: function(expectation) {
          return "\"" + literalEscape(expectation.text) + "\"";
        },

        "class": function(expectation) {
          var escapedParts = "",
              i;

          for (i = 0; i < expectation.parts.length; i++) {
            escapedParts += expectation.parts[i] instanceof Array
              ? classEscape(expectation.parts[i][0]) + "-" + classEscape(expectation.parts[i][1])
              : classEscape(expectation.parts[i]);
          }

          return "[" + (expectation.inverted ? "^" : "") + escapedParts + "]";
        },

        any: function(expectation) {
          return "any character";
        },

        end: function(expectation) {
          return "end of input";
        },

        other: function(expectation) {
          return expectation.description;
        }
      };

  function hex(ch) {
    return ch.charCodeAt(0).toString(16).toUpperCase();
  }

  function literalEscape(s) {
    return s
      .replace(/\\/g, '\\\\')
      .replace(/"/g,  '\\"')
      .replace(/\0/g, '\\0')
      .replace(/\t/g, '\\t')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
      .replace(/[\x00-\x0F]/g,          function(ch) { return '\\x0' + hex(ch); })
      .replace(/[\x10-\x1F\x7F-\x9F]/g, function(ch) { return '\\x'  + hex(ch); });
  }

  function classEscape(s) {
    return s
      .replace(/\\/g, '\\\\')
      .replace(/\]/g, '\\]')
      .replace(/\^/g, '\\^')
      .replace(/-/g,  '\\-')
      .replace(/\0/g, '\\0')
      .replace(/\t/g, '\\t')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
      .replace(/[\x00-\x0F]/g,          function(ch) { return '\\x0' + hex(ch); })
      .replace(/[\x10-\x1F\x7F-\x9F]/g, function(ch) { return '\\x'  + hex(ch); });
  }

  function describeExpectation(expectation) {
    return DESCRIBE_EXPECTATION_FNS[expectation.type](expectation);
  }

  function describeExpected(expected) {
    var descriptions = new Array(expected.length),
        i, j;

    for (i = 0; i < expected.length; i++) {
      descriptions[i] = describeExpectation(expected[i]);
    }

    descriptions.sort();

    if (descriptions.length > 0) {
      for (i = 1, j = 1; i < descriptions.length; i++) {
        if (descriptions[i - 1] !== descriptions[i]) {
          descriptions[j] = descriptions[i];
          j++;
        }
      }
      descriptions.length = j;
    }

    switch (descriptions.length) {
      case 1:
        return descriptions[0];

      case 2:
        return descriptions[0] + " or " + descriptions[1];

      default:
        return descriptions.slice(0, -1).join(", ")
          + ", or "
          + descriptions[descriptions.length - 1];
    }
  }

  function describeFound(found) {
    return found ? "\"" + literalEscape(found) + "\"" : "end of input";
  }

  return "Expected " + describeExpected(expected) + " but " + describeFound(found) + " found.";
};

function peg$parse(input, options) {
  options = options !== void 0 ? options : {};

  var peg$FAILED = {},

      peg$startRuleFunctions = { DOCUMENT: peg$parseDOCUMENT },
      peg$startRuleFunction  = peg$parseDOCUMENT,

      peg$c0 = function(h, p, f, q, v) {
        var commentsList = Object.entries(CommentsHash).map(([loc, str]) => ({line:parseInt(loc), text:str}));

        return {
          token: 'query',
          kind: 'query',
          header: flattenString(h),
          prologue: p,
          body: q,
          commentsList: commentsList,
          functions: f,
          inlineData: v,
          location: location()
        }
      },
      peg$c1 = function(h, b) {
        return {
          token: 'function',
          header:h,
          body:b
        }
      },
      peg$c2 = function(b, pfx) {
        return { token: 'prologue',
                 location: location(), 
                 base: b,
                 prefixes: pfx }
      },
      peg$c3 = "BASE",
      peg$c4 = peg$literalExpectation("BASE", false),
      peg$c5 = "base",
      peg$c6 = peg$literalExpectation("base", false),
      peg$c7 = function(i) {
        registerDefaultPrefix(i);
        
        var base = {location: location()};
        base.token = 'base';
        base.value = i;
        
        return base;
      },
      peg$c8 = "PREFIX",
      peg$c9 = peg$literalExpectation("PREFIX", false),
      peg$c10 = "prefix",
      peg$c11 = peg$literalExpectation("prefix", false),
      peg$c12 = function(p, l) {
        registerPrefix(p,l);
        
        var prefix = {};
        prefix.token = 'prefix';
        prefix.prefix = p;
        prefix.location = location();
        prefix.local = l;
        
        return prefix;
      },
      peg$c13 = function(s, gs, w, sm) {
        var dataset = {'named':[], 'implicit':[]};
        for(var i=0; i<gs.length; i++) {
          var g = gs[i];
          if(g.kind === 'default') {
            dataset['implicit'].push(g.graph);
          } else {
            dataset['named'].push(g.graph)
          }
        }
        
        if(dataset['named'].length === 0 && dataset['implicit'].length === 0) {
          dataset['implicit'].push({token:'uri',
                                    location: null,     
                                    prefix:null,
                                    suffix:null,
                                    value:'https://github.com/antoniogarrote/rdfstore-js#default_graph'});
        }
        
        var query = {location: location()};
        query.kind = 'select';
        query.token = 'executableunit';
        query.dataset = dataset;
        query.projection = s.vars;
        query.modifier = s.modifier;
        query.pattern = w;
        
        if(sm!=null && sm.limit!=null) {
          query.limit = sm.limit;
        }
        if(sm!=null && sm.offset!=null) {
          query.offset = sm.offset;
        }
        if(sm!=null && (sm.order!=null && sm.order!="")) {
          query.order = sm.order;
        }
        if(sm!=null && sm.group!=null) {
          query.group = sm.group;
        }
        
        return query;
      },
      peg$c14 = function(s, w, sm) {
        var query = {location: location()};

        query.kind = 'select';
        query.token = 'subselect';
        query.projection = s.vars;
        query.modifier = s.modifier;
        query.pattern = w;
        
        if(sm!=null && sm.limit!=null) {
          query.limit = sm.limit;
        }
        if(sm!=null && sm.offset!=null) {
          query.offset = sm.offset;
        }
        if(sm!=null && (sm.order!=null && sm.order!="")) {
          query.order = sm.order;
        }
        if(sm!=null && sm.group!=null) {
          query.group = sm.group;
        }
        
        return query;
      },
      peg$c15 = "SELECT",
      peg$c16 = peg$literalExpectation("SELECT", false),
      peg$c17 = "select",
      peg$c18 = peg$literalExpectation("select", false),
      peg$c19 = "DISTINCT",
      peg$c20 = peg$literalExpectation("DISTINCT", false),
      peg$c21 = "distinct",
      peg$c22 = peg$literalExpectation("distinct", false),
      peg$c23 = "REDUCED",
      peg$c24 = peg$literalExpectation("REDUCED", false),
      peg$c25 = "reduced",
      peg$c26 = peg$literalExpectation("reduced", false),
      peg$c27 = "(",
      peg$c28 = peg$literalExpectation("(", false),
      peg$c29 = "AS",
      peg$c30 = peg$literalExpectation("AS", false),
      peg$c31 = "as",
      peg$c32 = peg$literalExpectation("as", false),
      peg$c33 = ")",
      peg$c34 = peg$literalExpectation(")", false),
      peg$c35 = "*",
      peg$c36 = peg$literalExpectation("*", false),
      peg$c37 = function(mod, proj) {
        var vars = [];
        if(proj.length === 3 && proj[1]==="*") {
          return {vars: [{token: 'variable', location: location(), kind:'*'}], modifier:arrayToString(mod)};
        }
        
        for(var i=0; i< proj.length; i++) {
          var aVar = proj[i];
          
          if(aVar.length === 3) {
            vars.push({token: 'variable', kind:'var', value:aVar[1]});
          } else {
            vars.push({token: 'variable', kind:'aliased', expression: aVar[3], alias:aVar[7]})
          }
        }
        
        return {vars: vars, modifier:arrayToString(mod), location: location()};
      },
      peg$c38 = "CONSTRUCT",
      peg$c39 = peg$literalExpectation("CONSTRUCT", false),
      peg$c40 = "construct",
      peg$c41 = peg$literalExpectation("construct", false),
      peg$c42 = function(t, gs, w, sm) {
        var dataset = {'named':[], 'implicit':[]};
        for(var i=0; i<gs.length; i++) {
          var g = gs[i];
          if(g.kind === 'default') {
            dataset['implicit'].push(g.graph);
          } else {
            dataset['named'].push(g.graph)
          }
        }
        
        if(dataset['named'].length === 0 && dataset['implicit'].length === 0) {
          dataset['implicit'].push({token:'uri',
                                    prefix:null,
                                    suffix:null,
                                    value:'https://github.com/antoniogarrote/rdfstore-js#default_graph'});
        }
        
        var query = {location: location()};
        query.kind = 'construct';
        query.token = 'executableunit'
        query.dataset = dataset;
        query.template = t;
        query.pattern = w;
        
        if(sm!=null && sm.limit!=null) {
          query.limit = sm.limit;
        }
        if(sm!=null && sm.offset!=null) {
          query.offset = sm.offset;
        }
        if(sm!=null && (sm.order!=null && sm.order!="")) {
          query.order = sm.order;
        }

        return query
      },
      peg$c43 = "WHERE",
      peg$c44 = peg$literalExpectation("WHERE", false),
      peg$c45 = "where",
      peg$c46 = peg$literalExpectation("where", false),
      peg$c47 = "{",
      peg$c48 = peg$literalExpectation("{", false),
      peg$c49 = "}",
      peg$c50 = peg$literalExpectation("}", false),
      peg$c51 = function(gs, t, sm) {
        var dataset = {'named':[], 'implicit':[]};
        for(var i=0; i<gs.length; i++) {
          var g = gs[i];
          if(g.kind === 'default') {
            dataset['implicit'].push(g.graph);
          } else {
            dataset['named'].push(g.graph)
          }
        }
        
        
        if(dataset['named'].length === 0 && dataset['implicit'].length === 0) {
          dataset['implicit'].push({token:'uri',
                                    prefix:null,
                                    suffix:null,
                                    value:'https://github.com/antoniogarrote/rdfstore-js#default_graph'});
        }
        
        var query = {location: location()};
        query.kind = 'construct';
        query.token = 'executableunit'
        query.dataset = dataset;
        query.template = t;
        query.pattern = {
          token: "basicgraphpattern",
          triplesContext: t.triplesContext
        };
        
        if(sm!=null && sm.limit!=null) {
          query.limit = sm.limit;
        }
        if(sm!=null && sm.offset!=null) {
          query.offset = sm.offset;
        }
        if(sm!=null && (sm.order!=null && sm.order!="")) {
          query.order = sm.order;
        }
        return query
      },
      peg$c52 = "DESCRIBE",
      peg$c53 = peg$literalExpectation("DESCRIBE", false),
      peg$c54 = "ASK",
      peg$c55 = peg$literalExpectation("ASK", false),
      peg$c56 = "ask",
      peg$c57 = peg$literalExpectation("ask", false),
      peg$c58 = function(gs, w) {
        var dataset = {'named':[], 'implicit':[]};
        for(var i=0; i<gs.length; i++) {
          var g = gs[i];
          if(g.kind === 'implicit') {
            dataset['implicit'].push(g.graph);
          } else {
            dataset['named'].push(g.graph)
          }
        }
        
        if(dataset['named'].length === 0 && dataset['implicit'].length === 0) {
          dataset['implicit'].push(
            {token:'uri',
             prefix:null,
             suffix:null,
             value:'https://github.com/antoniogarrote/rdfstore-js#default_graph'});
        }
        
        var query = {location: location()};
        query.kind = 'ask';
        query.token = 'executableunit'
        query.dataset = dataset;
        query.pattern = w
        
        return query
      },
      peg$c59 = "FROM",
      peg$c60 = peg$literalExpectation("FROM", false),
      peg$c61 = "from",
      peg$c62 = peg$literalExpectation("from", false),
      peg$c63 = function(gs) {
        return gs;
      },
      peg$c64 = function(s) {
        return {graph:s , kind:'default', token:'graphClause', location: location()}
      },
      peg$c65 = "NAMED",
      peg$c66 = peg$literalExpectation("NAMED", false),
      peg$c67 = "named",
      peg$c68 = peg$literalExpectation("named", false),
      peg$c69 = function(s) {
        return {graph:s, kind:'named', token:'graphCluase', location: location()};
      },
      peg$c70 = function(g) {
        return g;
      },
      peg$c71 = function(gc, oc, lo) {
        var acum = {};
        if(lo != null) {
          if(lo.limit != null) {
            acum.limit = lo.limit;
          }
          if(lo.offset != null) {
            acum.offset = lo.offset;
          }
        }
        
        if(gc != null) {
          acum.group = gc;
        }
        
        acum.order = oc;
        
        return acum
      },
      peg$c72 = "GROUP",
      peg$c73 = peg$literalExpectation("GROUP", false),
      peg$c74 = "group",
      peg$c75 = peg$literalExpectation("group", false),
      peg$c76 = "BY",
      peg$c77 = peg$literalExpectation("BY", false),
      peg$c78 = "by",
      peg$c79 = peg$literalExpectation("by", false),
      peg$c80 = function(conds) {
        return conds;
      },
      peg$c81 = function(b) {
        return b;
      },
      peg$c82 = function(f) {
        return f;
      },
      peg$c83 = function(e, alias) {
        if(alias.length != 0) {
          return {token: 'aliased_expression',
                  location: location(),  
                  expression: e,
                  alias: alias[2] };
        } else {
              return e;
        }
      },
      peg$c84 = function(v) {
        return v;
      },
      peg$c85 = "HAVING",
      peg$c86 = peg$literalExpectation("HAVING", false),
      peg$c87 = "ORDER",
      peg$c88 = peg$literalExpectation("ORDER", false),
      peg$c89 = "order",
      peg$c90 = peg$literalExpectation("order", false),
      peg$c91 = function(os) {
        return os;
      },
      peg$c92 = "ASC",
      peg$c93 = peg$literalExpectation("ASC", false),
      peg$c94 = "asc",
      peg$c95 = peg$literalExpectation("asc", false),
      peg$c96 = "DESC",
      peg$c97 = peg$literalExpectation("DESC", false),
      peg$c98 = "desc",
      peg$c99 = peg$literalExpectation("desc", false),
      peg$c100 = function(direction, e) {
        return { direction: direction.toUpperCase(), expression:e };
      },
      peg$c101 = function(e) {
        if(e.token === 'var') {
          var e = { token:'expression',
                    location: location(),
                    expressionType:'atomic',
                    primaryexpression: 'var',
                    value: e };
        }
        return { direction: 'ASC', expression:e };
      },
      peg$c102 = function(cls) {
        var acum = {};
        for(var i=0; i<cls.length; i++) {
          var cl = cls[i];
          if(cl != null && cl.limit != null) {
            acum['limit'] = cl.limit;
          } else if(cl != null && cl.offset != null){
            acum['offset'] = cl.offset;
          }
        }
        
        return acum;
      },
      peg$c103 = "LIMIT",
      peg$c104 = peg$literalExpectation("LIMIT", false),
      peg$c105 = "limit",
      peg$c106 = peg$literalExpectation("limit", false),
      peg$c107 = function(i) {
        return { limit:parseInt(i.value) };
      },
      peg$c108 = "OFFSET",
      peg$c109 = peg$literalExpectation("OFFSET", false),
      peg$c110 = "offset",
      peg$c111 = peg$literalExpectation("offset", false),
      peg$c112 = function(i) {
        return { offset:parseInt(i.value) };
      },
      peg$c113 = "BINDINGS",
      peg$c114 = peg$literalExpectation("BINDINGS", false),
      peg$c115 = "UNDEF",
      peg$c116 = peg$literalExpectation("UNDEF", false),
      peg$c117 = "VALUES",
      peg$c118 = peg$literalExpectation("VALUES", false),
      peg$c119 = "values",
      peg$c120 = peg$literalExpectation("values", false),
      peg$c121 = function(b) {
        if(b != null) {
          return b[1];
        } else {
          return null;
        }
      },
      peg$c122 = ";",
      peg$c123 = peg$literalExpectation(";", false),
      peg$c124 = function(p, u, us) {
        var query = {};
        query.token = 'query';
        query.kind = 'update'
        query.prologue = p;
        
        var units = [u];

        if(us != null && us.length != null && us[3] != null && us[3].units != null) {
          units = units.concat(us[3].units);
        }
        
        query.units = units;
        return query;
      },
      peg$c125 = "LOAD",
      peg$c126 = peg$literalExpectation("LOAD", false),
      peg$c127 = "load",
      peg$c128 = peg$literalExpectation("load", false),
      peg$c129 = "INTO",
      peg$c130 = peg$literalExpectation("INTO", false),
      peg$c131 = "into",
      peg$c132 = peg$literalExpectation("into", false),
      peg$c133 = function(sg, dg) {
        var query = {};
        query.kind = 'load';
        query.token = 'executableunit';
        query.sourceGraph = sg;
        if(dg != null) {
          query.destinyGraph = dg[2];
        }
        return query;
      },
      peg$c134 = "CLEAR",
      peg$c135 = peg$literalExpectation("CLEAR", false),
      peg$c136 = "clear",
      peg$c137 = peg$literalExpectation("clear", false),
      peg$c138 = "SILENT",
      peg$c139 = peg$literalExpectation("SILENT", false),
      peg$c140 = "silent",
      peg$c141 = peg$literalExpectation("silent", false),
      peg$c142 = function(ref) {
        var query = {};
        query.kind = 'clear';
        query.token = 'executableunit'
        query.destinyGraph = ref;
        
        return query;
      },
      peg$c143 = "DROP",
      peg$c144 = peg$literalExpectation("DROP", false),
      peg$c145 = "drop",
      peg$c146 = peg$literalExpectation("drop", false),
      peg$c147 = function(ref) {
        var query = {};
        query.kind = 'drop';
        query.token = 'executableunit'
        query.destinyGraph = ref;
        
        return query;
      },
      peg$c148 = "CREATE",
      peg$c149 = peg$literalExpectation("CREATE", false),
      peg$c150 = "create",
      peg$c151 = peg$literalExpectation("create", false),
      peg$c152 = function(ref) {
        var query = {};
        query.kind = 'create';
        query.token = 'executableunit'
        query.destinyGraph = ref;
        
        return query;
      },
      peg$c153 = "INSERT",
      peg$c154 = peg$literalExpectation("INSERT", false),
      peg$c155 = "insert",
      peg$c156 = peg$literalExpectation("insert", false),
      peg$c157 = "DATA",
      peg$c158 = peg$literalExpectation("DATA", false),
      peg$c159 = "data",
      peg$c160 = peg$literalExpectation("data", false),
      peg$c161 = function(qs) {
        var query = {};
        query.kind = 'insertdata';
        query.token = 'executableunit'
        query.quads = qs;
        
        return query;
      },
      peg$c162 = "DELETE",
      peg$c163 = peg$literalExpectation("DELETE", false),
      peg$c164 = "delete",
      peg$c165 = peg$literalExpectation("delete", false),
      peg$c166 = function(qs) {
        var query = {};

        query.kind = 'deletedata';
        query.token = 'executableunit'
        query.quads = qs;
        
        return query;
      },
      peg$c167 = function(p) {
        var query = {};
        query.kind = 'modify';
        query.pattern = p;
        query.with = null;
        query.using = null;
        
        var quads = [];
        
        var patternsCollection = p.patterns[0];
        if(patternsCollection.triplesContext == null && patternsCollection.patterns!=null) {
          patternsCollection = patternsCollection.patterns[0].triplesContext;
        } else {
          patternsCollection = patternsCollection.triplesContext;
        }
        
        for(var i=0; i<patternsCollection.length; i++) {
          var quad = {};
          var contextQuad = patternsCollection[i];
          
          quad['subject'] = contextQuad['subject'];
          quad['predicate'] = contextQuad['predicate'];
          quad['object'] = contextQuad['object'];
          quad['graph'] = contextQuad['graph'];
          
          quads.push(quad);
        }
        
        query.delete = quads;
        
        return query;
      },
      peg$c168 = "WITH",
      peg$c169 = peg$literalExpectation("WITH", false),
      peg$c170 = "with",
      peg$c171 = peg$literalExpectation("with", false),
      peg$c172 = function(wg, dic, uc, p) {
        var query = {};
        query.kind = 'modify';
        
        if(wg != "" && wg != null) {
          query.with = wg[2];
        } else {
          query.with = null;
        }
        
        
        if(dic.length === 3 && (dic[2] === ''|| dic[2] == null)) {
          query.delete = dic[0];
          query.insert = null;
        } else if(dic.length === 3 && dic[0].length != null && dic[1].length != null && dic[2].length != null) {
          query.delete = dic[0];
          query.insert = dic[2];
        } else  {
          query.insert = dic;
          query.delete = null;
        }
        
        if(uc != '') {
          query.using = uc;
        }
        
        query.pattern = p;
        
        return query;
      },
      peg$c173 = function(q) {
        return q;
      },
      peg$c174 = "USING",
      peg$c175 = peg$literalExpectation("USING", false),
      peg$c176 = "using",
      peg$c177 = peg$literalExpectation("using", false),
      peg$c178 = function(g) {
        if(g.length!=null) {
          return {kind: 'named', uri: g[2]};
        } else {
          return {kind: 'default', uri: g};
        }
      },
      peg$c179 = "GRAPH",
      peg$c180 = peg$literalExpectation("GRAPH", false),
      peg$c181 = "graph",
      peg$c182 = peg$literalExpectation("graph", false),
      peg$c183 = function(i) {
        return i;
      },
      peg$c184 = "DEFAULT",
      peg$c185 = peg$literalExpectation("DEFAULT", false),
      peg$c186 = "default",
      peg$c187 = peg$literalExpectation("default", false),
      peg$c188 = function() {
        return 'default';
      },
      peg$c189 = function() {
        return 'named';
      },
      peg$c190 = "ALL",
      peg$c191 = peg$literalExpectation("ALL", false),
      peg$c192 = "all",
      peg$c193 = peg$literalExpectation("all", false),
      peg$c194 = function() {
        return 'all';
      },
      peg$c195 = function(qs) {
        return qs.quadsContext;
      },
      peg$c196 = ".",
      peg$c197 = peg$literalExpectation(".", false),
      peg$c198 = function(ts, qs) {
        var quads = [];
        if(ts != null && ts.triplesContext != null) {
          for(var i=0; i<ts.triplesContext.length; i++) {
            var triple = ts.triplesContext[i]
            triple.graph = null;
            quads.push(triple)
          }
        }

        if(qs && qs.length>0 && qs[0].length > 0) {
          quads = quads.concat(qs[0][0].quadsContext);
          
          if( qs[0][2] != null && qs[0][2].triplesContext != null) {
            for(var i=0; i<qs[0][2].triplesContext.length; i++) {
              var triple = qs[0][2].triplesContext[i]
              triple.graph = null;
              quads.push(triple)
            }
          }
        }
        
        return {token:'quads',
                location: location(),
                quadsContext: quads}
      },
      peg$c199 = function(g, ts) {
        var quads = [];
        if(ts!=null) {
          for (var i = 0; i < ts.triplesContext.length; i++) {
            var triple = ts.triplesContext[i];
            triple.graph = g;
            quads.push(triple)
          }
        }
        
        return {token:'quadsnottriples',
                location: location(),
                quadsContext: quads}
      },
      peg$c200 = function(b, bs) {
        var triples = b.triplesContext;
        if(bs != null && typeof(bs) === 'object') {
          if(bs.length != null) {
            if(bs[3] != null && bs[3].triplesContext!=null) {
              triples = triples.concat(bs[3].triplesContext);
            }
          }
        }
        
        return {
          token:'triplestemplate',
          location: location(),
          triplesContext: triples
        };
      },
      peg$c201 = function(p) {
        return p;
      },
      peg$c202 = function(tb, tbs) {
        var subpatterns = [];
        if(tb != null && tb != []) {
          subpatterns.push(tb);
        }
        
        for(var i=0; i<tbs.length; i++) {
          for(var j=0; j< tbs[i].length; j++) {
            if(tbs[i][j] != null && tbs[i][j].token != null) {
              subpatterns.push(tbs[i][j]);
            }
          }
        }
        
        var compactedSubpatterns = [];
        
        var currentBasicGraphPatterns = [];
        var currentFilters = [];
        var currentBinds = [];
        
        for(var i=0; i<subpatterns.length; i++) {
          if(subpatterns[i].token!=='triplespattern' && subpatterns[i].token !== 'filter' && subpatterns[i].token !== 'bind') {
            if(currentBasicGraphPatterns.length != 0 || currentFilters.length != 0) {
              var triplesContext = [];
              for(var j=0; j<currentBasicGraphPatterns.length; j++) {
                triplesContext = triplesContext.concat(currentBasicGraphPatterns[j].triplesContext);
              }
              if(triplesContext.length > 0) {
                compactedSubpatterns.push(
                          {token: 'basicgraphpattern',
                           location: location(),
                           triplesContext: triplesContext});
              }
              currentBasicGraphPatterns = [];
            }
            compactedSubpatterns.push(subpatterns[i]);
          } else {
            if(subpatterns[i].token === 'triplespattern') {
              currentBasicGraphPatterns.push(subpatterns[i]);
            } else if(subpatterns[i].token === 'bind') {
              currentBinds.push(subpatterns[i]);
              
            } else {
              currentFilters.push(subpatterns[i]);
            }
          }
        }
        
        if(currentBasicGraphPatterns.length != 0 || currentFilters.length != 0) {
          var triplesContext = [];
          for(var j=0; j<currentBasicGraphPatterns.length; j++) {
            triplesContext = triplesContext.concat(currentBasicGraphPatterns[j].triplesContext);
          }
          if(triplesContext.length > 0) {
            compactedSubpatterns.push({token: 'basicgraphpattern',
                                       location: location(),
                                       triplesContext: triplesContext});
          }
        }
        
      //      if(compactedSubpatterns.length == 1) {
      //          compactedSubpatterns[0].filters = currentFilters;
      //          return compactedSubpatterns[0];
      //      } else  {
        return { token: 'groupgraphpattern',
                 location: location(),
                 patterns: compactedSubpatterns,
                 filters: currentFilters,
                 binds: currentBinds
               }
      //      }
      },
      peg$c203 = function(b, bs) {
        var triples = b.triplesContext;
        if(bs != null && typeof(bs) === 'object') {
          if(bs != null && bs.length != null) {
            if(bs[2] != null && bs[2].triplesContext!=null) {
              triples = triples.concat(bs[2].triplesContext);
            }
          }
        }
        
        return {token:'triplespattern',
                location: location(),
                triplesContext: triples}
      },
      peg$c204 = "OPTIONAL",
      peg$c205 = peg$literalExpectation("OPTIONAL", false),
      peg$c206 = "optional",
      peg$c207 = peg$literalExpectation("optional", false),
      peg$c208 = function(v) {
        return { token: 'optionalgraphpattern',
                 location: location(),
                 value: v }
      },
      peg$c209 = function(g, gg) {
        for(var i=0; i<gg.patterns.length; i++) {
          var quads = []
          var ts = gg.patterns[i];
          for(var j=0; j<ts.triplesContext.length; j++) {
            var triple = ts.triplesContext[j]
            triple.graph = g;
          }
        }
        
        gg.token = 'groupgraphpattern'
        return gg;
      },
      peg$c210 = "SERVICE",
      peg$c211 = peg$literalExpectation("SERVICE", false),
      peg$c212 = function(v, ts) {
        return {token: 'servicegraphpattern',
                location: location(),
                status: 'todo',
                value: [v,ts] }
      },
      peg$c213 = "MINUS",
      peg$c214 = peg$literalExpectation("MINUS", false),
      peg$c215 = "minus",
      peg$c216 = peg$literalExpectation("minus", false),
      peg$c217 = function(ts) {
        return {token: 'minusgraphpattern',
                location: location(),
                status: 'todo',
                value: ts}
      },
      peg$c218 = "UNION",
      peg$c219 = peg$literalExpectation("UNION", false),
      peg$c220 = "union",
      peg$c221 = peg$literalExpectation("union", false),
      peg$c222 = function(a, b) {
        if(b.length === 0) {
          return a;
        } else {
          var lastToken = {token: 'graphunionpattern',
                           location: location(),
                           value: [a]};
          
          for(var i=0; i<b.length; i++) {
            if(i==b.length-1) {
              lastToken.value.push(b[i][3]);
            } else {
              lastToken.value.push(b[i][3]);
              var newToken = {token: 'graphunionpattern',
                              location: location(),
                              value: [lastToken]}
              
              lastToken = newToken;
            }
          }
          
          return lastToken;
        }
      },
      peg$c223 = "FILTER",
      peg$c224 = peg$literalExpectation("FILTER", false),
      peg$c225 = "filter",
      peg$c226 = peg$literalExpectation("filter", false),
      peg$c227 = function(c) {
        return {token: 'filter',
                location: location(),
                value: c}
      },
      peg$c228 = "BIND",
      peg$c229 = peg$literalExpectation("BIND", false),
      peg$c230 = "bind",
      peg$c231 = peg$literalExpectation("bind", false),
      peg$c232 = function(ex, v) {
        return {token: 'bind',
                location: location(),
                expression: ex,
                as: v};
      },
      peg$c233 = function(d) {
        return d;
      },
      peg$c234 = function(v, d) {
        var result =  {
          token: 'inlineData',
          location: location(),
          // values: [{
          //   'var': v,
          //   'value': d
          // }]
          var: v,
          values: d
        };
        
        return result;
      },
      peg$c235 = function(vars, vals) {
        var result = {token: 'inlineDataFull',
                      location: location(),
                      variables: vars,
                      // values: vars.map((v, i) => { return  { 'var': v, 'value': vals[i] }; })
                      values: vals};
        return result;
      },
      peg$c236 = function(val) {
        return val;
      },
      peg$c237 = function(i, args) {
        var fcall = {};
        fcall.token = "expression";
        fcall.expressionType = 'functioncall'
        fcall.iriref = i;
        fcall.args = args.value;
        
        return fcall;
      },
      peg$c238 = function() {
        var args = {};
        args.token = 'args';
        args.value = [];
        return args;
      },
      peg$c239 = ",",
      peg$c240 = peg$literalExpectation(",", false),
      peg$c241 = function(d, e, es) {
        var cleanEx = [];
        
        for(var i=0; i<es.length; i++) {
          cleanEx.push(es[i][2]);
        }
        var args = {};
        args.token = 'args';
        args.value = [e].concat(cleanEx);
        
        if(d!=null && d.toUpperCase()==="DISTINCT") {
          args.distinct = true;
        } else {
          args.distinct = false;
        }
        
        return args;
      },
      peg$c242 = function(e, es) {
        var cleanEx = [];
        
        for(var i=0; i<es.length; i++) {
          cleanEx.push(es[i][2]);
        }
        var args = {};
        args.token = 'args';
        args.value = [e].concat(cleanEx);
        
        return args;
      },
      peg$c243 = function(ts) {
        return ts;
      },
      peg$c244 = function(b, bs) {
        var triples = b.triplesContext;
        var toTest = null;
        if(bs != null && typeof(bs) === 'object') {
          if(bs.length != null) {
            if(bs[3] != null && bs[3].triplesContext!=null) {
              triples = triples.concat(bs[3].triplesContext);
            }
          }
        }
        
        return {token:'triplestemplate',
                location: location(),
                triplesContext: triples}
      },
      peg$c245 = function(s, pairs) {
        var triplesContext = pairs.triplesContext;
        var subject = s;
        if(pairs.pairs) {
          for(var i=0; i< pairs.pairs.length; i++) {
            var pair = pairs.pairs[i];
            var triple = null;
            if(pair[1].length != null)
              pair[1] = pair[1][0]
            if(subject.token && subject.token==='triplesnodecollection') {
              triple = {subject: subject.chainSubject[0], predicate: pair[0], object: pair[1]}
              triplesContext.push(triple);
              triplesContext = triplesContext.concat(subject.triplesContext);
            } else {
              triple = {subject: subject, predicate: pair[0], object: pair[1]}
              triplesContext.push(triple);
            }
          }
        }
        
        var token = {};
        token.token = "triplessamesubject";
        token.triplesContext = triplesContext;
        token.chainSubject = subject;
        
        return token;
      },
      peg$c246 = function(tn, pairs) {
        var triplesContext = tn.triplesContext;
        var subject = tn.chainSubject;
        
        if(pairs.pairs) {
          for(var i=0; i< pairs.pairs.length; i++) {
            var pair = pairs.pairs[i];
            if(pair[1].length != null)
              pair[1] = pair[1][0]
            
            if(tn.token === "triplesnodecollection") {
              for(var j=0; j<subject.length; j++) {
                var subj = subject[j];
                if(subj.triplesContext != null) {
                  var triple = {subject: subj.chainSubject, predicate: pair[0], object: pair[1]}
                  triplesContext.concat(subj.triplesContext);
                } else {
                  var triple = {subject: subject[j], predicate: pair[0], object: pair[1]}
                  triplesContext.push(triple);
                }
              }
            } else {
              var triple = {subject: subject, predicate: pair[0], object: pair[1]}
              triplesContext.push(triple);
            }
          }
        }
        
        var token = {};
        token.token = "triplessamesubject";
        token.triplesContext = triplesContext;
        token.chainSubject = subject;
        
        return token;
      },
      peg$c247 = function(v, ol, rest) {
        var tokenParsed = {};
        tokenParsed.token = 'propertylist';
        var triplesContext = [];
        var pairs = [];
        var test = [];
        
        for( var i=0; i<ol.length; i++) {
          
          if(ol[i].triplesContext != null) {
            triplesContext = triplesContext.concat(ol[i].triplesContext);
            if(ol[i].token==='triplesnodecollection' && ol[i].chainSubject.length != null) {
              pairs.push([v, ol[i].chainSubject[0]]);
            } else {
              pairs.push([v, ol[i].chainSubject]);
            }
            
          } else {
            pairs.push([v, ol[i]])
          }
          
        }
        
        
        for(var i=0; i<rest.length; i++) {
          var tok = rest[i][3];
          var newVerb  = tok[0];
          var newObjsList = tok[2] || [];
          
          for(var j=0; j<newObjsList.length; j++) {
            if(newObjsList[j].triplesContext != null) {
              triplesContext = triplesContext.concat(newObjsList[j].triplesContext);
              pairs.push([newVerb, newObjsList[j].chainSubject]);
            } else {
              pairs.push([newVerb, newObjsList[j]])
            }
          }
        }
        
        tokenParsed.pairs = pairs;
        tokenParsed.triplesContext = triplesContext;
        
        return tokenParsed;
      },
      peg$c248 = function(obj, objs) {
        var toReturn = [];
        
        toReturn.push(obj);
        
        for(var i=0; i<objs.length; i++) {
          for(var j=0; j<objs[i].length; j++) {
            if(typeof(objs[i][j])=="object" && objs[i][j].token != null) {
              toReturn.push(objs[i][j]);
            }
          }
        }
        
        return toReturn;
      },
      peg$c249 = "a",
      peg$c250 = peg$literalExpectation("a", false),
      peg$c251 = function() {
        return {token: 'uri', 
                prefix:null, 
                suffix:null,
                location: location(),
                value:"http://www.w3.org/1999/02/22-rdf-syntax-ns#type"}
      },
      peg$c252 = function(s, pairs) {
        var triplesContext = pairs.triplesContext;
        var subject = s;
        if(pairs.pairs) {
          for(var i=0; i< pairs.pairs.length; i++) {
            var pair = pairs.pairs[i];
            var triple = null;
            if(pair[1].length != null)
              pair[1] = pair[1][0]
            if(subject.token && subject.token==='triplesnodecollection') {
              triple = {subject: subject.chainSubject[0], predicate: pair[0], object: pair[1]};
              if(triple.predicate.token === 'path' && triple.predicate.kind === 'element') {
                triple.predicate = triple.predicate.value;
              }
              triplesContext.push(triple);
              triplesContext = triplesContext.concat(subject.triplesContext);
            } else {
              triple = {subject: subject, predicate: pair[0], object: pair[1]}
              if(triple.predicate.token === 'path' && triple.predicate.kind === 'element') {
                triple.predicate = triple.predicate.value;
              }
              triplesContext.push(triple);
            }
          }
        }

        var tokenParsed = {};
        tokenParsed.token = "triplessamesubject";
        tokenParsed.triplesContext = triplesContext;
        tokenParsed.chainSubject = subject;

        return tokenParsed;
      },
      peg$c253 = function(tn, pairs) {
        var triplesContext = tn.triplesContext;
        var subject = tn.chainSubject;

        if(pairs != null && pairs.pairs != null) {
          for(var i=0; i< pairs.pairs.length; i++) {
            var pair = pairs.pairs[i];
            if(pair[1].length != null)
              pair[1] = pair[1][0]

            if(tn.token === "triplesnodecollection") {
              for(var j=0; j<subject.length; j++) {
                var subj = subject[j];
                if(subj.triplesContext != null) {
                  var triple = {subject: subj.chainSubject, predicate: pair[0], object: pair[1]}
                  triplesContext.concat(subj.triplesContext);
                } else {
                  var triple = {subject: subject[j], predicate: pair[0], object: pair[1]}
                  triplesContext.push(triple);
                }
              }
            } else {
              var triple = {subject: subject, predicate: pair[0], object: pair[1]}
              triplesContext.push(triple);
            }
          }
        }

        var tokenParsed = {};
        tokenParsed.token = "triplessamesubject";
        tokenParsed.triplesContext = triplesContext;
        tokenParsed.chainSubject = subject;

        return tokenParsed;
      },
      peg$c254 = function(v, ol, rest) {
        var token = {}
        token.token = 'propertylist';
        var triplesContext = [];
        var pairs = [];
        var test = [];
        
        for( var i=0; i<ol.length; i++) {
          
          if(ol[i].triplesContext != null) {
            triplesContext = triplesContext.concat(ol[i].triplesContext);
            if(ol[i].token==='triplesnodecollection' && ol[i].chainSubject.length != null) {
              pairs.push([v, ol[i].chainSubject[0]]);
            } else {
              pairs.push([v, ol[i].chainSubject]);
            }
            
          } else {
            pairs.push([v, ol[i]])
          }
          
        }
        
        
        for(var i=0; i<rest.length; i++) {
          var tok = rest[i][3];
          var newVerb  = tok[0];
          var newObjsList = tok[1] || [];
          
          for(var j=0; j<newObjsList.length; j++) {
            if(newObjsList[j].triplesContext != null) {
              triplesContext = triplesContext.concat(newObjsList[j].triplesContext);
              pairs.push([newVerb, newObjsList[j].chainSubject]);
            } else {
              pairs.push([newVerb, newObjsList[j]])
            }
          }
        }
        
        token.pairs = pairs;
        token.triplesContext = triplesContext;
        
        return token;
      },
      peg$c255 = function(p) {
        var path = {};
        path.token = 'path';
        path.kind = 'element';
        path.value = p;
        path.location = location();
        
        return p; // return path?
      },
      peg$c256 = "|",
      peg$c257 = peg$literalExpectation("|", false),
      peg$c258 = function(first, rest) {
        if(rest == null || rest.length === 0) {
          return first;
        } else {
          var acum = [];
          for(var i=0; i<rest.length; i++)
            acum.push(rest[1]);
          
          var path = {};
          path.token = 'path';
          path.kind = 'alternative';
          path.value = acum;
          path.location = location();
          
          return path;
        }
      },
      peg$c259 = "/",
      peg$c260 = peg$literalExpectation("/", false),
      peg$c261 = function(first, rest) {
        if(rest == null || rest.length === 0) {
          return first;
        } else {
          var acum = [first];
          
          for(var i=0; i<rest.length; i++)
            acum.push(rest[i][1]);
          
          var path = {};
          path.token = 'path';
          path.kind = 'sequence';
          path.value = acum;
          path.location = location();
          
          return path;
        }
      },
      peg$c262 = function(p, mod) {
        if(p.token && p.token != 'path' && mod == '') { // uri without mod
          p.kind = 'primary' // for debug
          return p;
        // } else if(p.token && p.token != path && mod != '') { // bug?
        } else if(p.token && p.token != 'path' && mod != '') { // uri with mod
          var path = {};
          path.token = 'path';
          path.kind = 'element';
          path.value = p;
          path.modifier = mod;
          return path;
        } else {
          p.modifier = mod;
          return p;
        }
      },
      peg$c263 = "^",
      peg$c264 = peg$literalExpectation("^", false),
      peg$c265 = function(elt) {
          var path = {};
          path.token = 'path';
          path.kind = 'inversePath';
          path.value = elt;
          
          return path;
      },
      peg$c266 = "?",
      peg$c267 = peg$literalExpectation("?", false),
      peg$c268 = "+",
      peg$c269 = peg$literalExpectation("+", false),
      peg$c270 = function(m) {
        return m;
      },
      peg$c271 = function() {
        return{token: 'uri',  location: location(), prefix:null, suffix:null, value:"http://www.w3.org/1999/02/22-rdf-syntax-ns#type"}
      },
      peg$c272 = "!",
      peg$c273 = peg$literalExpectation("!", false),
      peg$c274 = function(c) {
          var triplesContext = [];
          var chainSubject = [];

          var triple = null;

          // catch NIL
          /*
           if(c.length == 1 && c[0].token && c[0].token === 'nil') {
           GlobalBlankNodeCounter++;
           return  {token: "triplesnodecollection",
           triplesContext:[{subject: {token:'blank', value:("_:"+GlobalBlankNodeCounter)},
           predicate:{token:'uri', prefix:null, suffix:null, value:'http://www.w3.org/1999/02/22-rdf-syntax-ns#rest'},
           object:  {token:'blank', value:("_:"+(GlobalBlankNodeCounter+1))}}],
           chainSubject:{token:'blank', value:("_:"+GlobalBlankNodeCounter)}};

           }
           */

          // other cases
          for(var i=0; i<c.length; i++) {
              GlobalBlankNodeCounter++;
              //_:b0  rdf:first  1 ;
              //rdf:rest   _:b1 .
              var nextObject = null;
              if(c[i].chainSubject == null && c[i].triplesContext == null) {
                  nextObject = c[i];
              } else {
                  nextObject = c[i].chainSubject;
                  triplesContext = triplesContext.concat(c[i].triplesContext);
              }
              triple = {
                  subject: {token:'blank', value:("_:"+GlobalBlankNodeCounter)},
                  predicate:{token:'uri', prefix:null, suffix:null, value:'http://www.w3.org/1999/02/22-rdf-syntax-ns#first'},
                  object:nextObject
              };

              if(i==0) {
                  chainSubject.push(triple.subject);
              }

              triplesContext.push(triple);

              if(i===(c.length-1)) {
                  triple = {subject: {token:'blank', value:("_:"+GlobalBlankNodeCounter)},
                      predicate:{token:'uri', prefix:null, suffix:null, value:'http://www.w3.org/1999/02/22-rdf-syntax-ns#rest'},
                      object:   {token:'uri', prefix:null, suffix:null, value:'http://www.w3.org/1999/02/22-rdf-syntax-ns#nil'}};
              } else {
                  triple = {subject: {token:'blank', value:("_:"+GlobalBlankNodeCounter)},
                      predicate:{token:'uri', prefix:null, suffix:null, value:'http://www.w3.org/1999/02/22-rdf-syntax-ns#rest'},
                      object:  {token:'blank', value:("_:"+(GlobalBlankNodeCounter+1))} };
              }

              triplesContext.push(triple);
          }

            return {token:"triplesnodecollection", triplesContext:triplesContext, chainSubject:chainSubject,  location: location()};
      },
      peg$c275 = function(c) {
        var triplesContext = [];
        var chainSubject = [];

        var triple = null;

        // catch NIL
        /*
         if(c.length == 1 && c[0].token && c[0].token === 'nil') {
         GlobalBlankNodeCounter++;
         return  {token: "triplesnodecollection",
         triplesContext:[{subject: {token:'blank', value:("_:"+GlobalBlankNodeCounter)},
         predicate:{token:'uri', prefix:null, suffix:null, value:'http://www.w3.org/1999/02/22-rdf-syntax-ns#rest'},
         object:  {token:'blank', value:("_:"+(GlobalBlankNodeCounter+1))}}],
         chainSubject:{token:'blank', value:("_:"+GlobalBlankNodeCounter)}};

         }
         */

        // other cases
        for(var i=0; i<c.length; i++) {
          GlobalBlankNodeCounter++;
          //_:b0  rdf:first  1 ;
          //rdf:rest   _:b1 .
          var nextObject = null;
          if(c[i].chainSubject == null && c[i].triplesContext == null) {
            nextObject = c[i];
          } else {
            nextObject = c[i].chainSubject;
            triplesContext = triplesContext.concat(nextObject.triplesContext);
          }
          triple = {subject: {token:'blank', value:("_:"+GlobalBlankNodeCounter)},
                    predicate:{token:'uri', prefix:null, suffix:null, value:'http://www.w3.org/1999/02/22-rdf-syntax-ns#first'},
                    object:nextObject };

          if(i==0) {
            chainSubject.push(triple.subject);
          }

          triplesContext.push(triple);

          if(i===(c.length-1)) {
            triple = {subject: {token:'blank', value:("_:"+GlobalBlankNodeCounter)},
                      predicate:{token:'uri', prefix:null, suffix:null, value:'http://www.w3.org/1999/02/22-rdf-syntax-ns#rest'},
                      object:   {token:'uri', prefix:null, suffix:null, value:'http://www.w3.org/1999/02/22-rdf-syntax-ns#nil'}};
          } else {
            triple = {subject: {token:'blank', value:("_:"+GlobalBlankNodeCounter)},
                      predicate:{token:'uri', prefix:null, suffix:null, value:'http://www.w3.org/1999/02/22-rdf-syntax-ns#rest'},
                      object:  {token:'blank', value:("_:"+(GlobalBlankNodeCounter+1))} };
          }

          triplesContext.push(triple);
        }

        return {token:"triplesnodecollection", triplesContext:triplesContext, chainSubject:chainSubject};
      },
      peg$c276 = "[",
      peg$c277 = peg$literalExpectation("[", false),
      peg$c278 = "]",
      peg$c279 = peg$literalExpectation("]", false),
      peg$c280 = function(pl) {
        GlobalBlankNodeCounter++;
        var subject = {token:'blank', value:'_:'+GlobalBlankNodeCounter};
        var newTriples =  [];

        for(var i=0; i< pl.pairs.length; i++) {
          var pair = pl.pairs[i];
          var triple = {}
          triple.subject = subject;
          triple.predicate = pair[0];
          if(pair[1].length != null)
            pair[1] = pair[1][0]
          triple.object = pair[1];
          newTriples.push(triple);
        }

        return {
          token: 'triplesnode',
          location: location(),
          kind: 'blanknodepropertylist',
          triplesContext: pl.triplesContext.concat(newTriples),
          chainSubject: subject
        };
      },
      peg$c281 = function(gn) {
        return gn;
      },
      peg$c282 = function(gn) {
        return gn[1];
      },
      peg$c283 = function(v) {
        var term = {location: location()};

        term.token = 'var';

        // term.value = v;
        term.prefix = v.prefix;
        term.value = v.value;

        return term;
      },
      peg$c284 = "||",
      peg$c285 = peg$literalExpectation("||", false),
      peg$c286 = function(v, vs) {
        if(vs.length === 0) {
          return v;
        }
        
        var exp = {};
        exp.token = "expression";
        exp.expressionType = "conditionalor";
        var ops = [v];
        
        for(var i=0; i<vs.length; i++) {
          ops.push(vs[i][3]);
        }
        
        exp.operands = ops;
        
        return exp;
      },
      peg$c287 = "&&",
      peg$c288 = peg$literalExpectation("&&", false),
      peg$c289 = function(v, vs) {
        if(vs.length === 0) {
          return v;
        }
        var exp = {};
        exp.token = "expression";
        exp.expressionType = "conditionaland";
        var ops = [v];
        
        for(var i=0; i<vs.length; i++) {
          ops.push(vs[i][3]);
        }
        
        exp.operands = ops;
        
        return exp;
      },
      peg$c290 = "=",
      peg$c291 = peg$literalExpectation("=", false),
      peg$c292 = "!=",
      peg$c293 = peg$literalExpectation("!=", false),
      peg$c294 = "<",
      peg$c295 = peg$literalExpectation("<", false),
      peg$c296 = ">",
      peg$c297 = peg$literalExpectation(">", false),
      peg$c298 = "<=",
      peg$c299 = peg$literalExpectation("<=", false),
      peg$c300 = ">=",
      peg$c301 = peg$literalExpectation(">=", false),
      peg$c302 = "I",
      peg$c303 = peg$literalExpectation("I", false),
      peg$c304 = "i",
      peg$c305 = peg$literalExpectation("i", false),
      peg$c306 = "N",
      peg$c307 = peg$literalExpectation("N", false),
      peg$c308 = "n",
      peg$c309 = peg$literalExpectation("n", false),
      peg$c310 = "O",
      peg$c311 = peg$literalExpectation("O", false),
      peg$c312 = "o",
      peg$c313 = peg$literalExpectation("o", false),
      peg$c314 = "T",
      peg$c315 = peg$literalExpectation("T", false),
      peg$c316 = "t",
      peg$c317 = peg$literalExpectation("t", false),
      peg$c318 = function(op1, op2) {
        if(op2.length === 0) {
          return op1;
        } else if(op2[0][1] === 'i' || op2[0][1] === 'I' || op2[0][1] === 'n' || op2[0][1] === 'N'){
          var exp = {};
          
          if(op2[0][1] === 'i' || op2[0][1] === 'I') {
            var operator = "=";
            exp.expressionType = "conditionalor"
          } else {
            var operator = "!=";
            exp.expressionType = "conditionaland"
          }
          var lop = op1;
          var rops = []
          for(var opi=0; opi<op2[0].length; opi++) {
            if(op2[0][opi].token ==="args") {
              rops = op2[0][opi].value;
              break;
            }
          }
          
          exp.token = "expression";
          exp.operands = [];
          for(var i=0; i<rops.length; i++) {
            var nextOperand = {};
            nextOperand.token = "expression";
            nextOperand.expressionType = "relationalexpression";
            nextOperand.operator = operator;
            nextOperand.op1 = lop;
            nextOperand.op2 = rops[i];
            
            exp.operands.push(nextOperand);
          }
          return exp;
        } else {
          var exp = {};
          exp.expressionType = "relationalexpression"
          exp.operator = op2[0][1];
          exp.op1 = op1;
          exp.op2 = op2[0][3];
          exp.token = "expression";
          
          return exp;
        }
      },
      peg$c319 = "-",
      peg$c320 = peg$literalExpectation("-", false),
      peg$c321 = function(op1, ops) {
        if(ops.length === 0) {
          return op1;
        }

        var ex = {};
        ex.token = 'expression';
        ex.expressionType = 'additiveexpression';
        ex.summand = op1;
        ex.summands = [];
        
        for(var i=0; i<ops.length; i++) {
          var summand = ops[i];
          var sum = {};
          if(summand.length == 4 && typeof(summand[1]) === "string") {
            sum.operator = summand[1];
            sum.expression = summand[3];
          } else {
            var subexp = {}
            var firstFactor = sum[0];
            var operator = sum[1][1];
            var secondFactor = sum[1][3];
            var operator = null;
            if(firstFactor.value < 0) {
              sum.operator = '-';
              firstFactor.value = - firstFactor.value;
            } else {
              sum.operator = '+';
            }
            subexp.token = 'expression';
            subexp.expressionType = 'multiplicativeexpression';
            subexp.operator = firstFactor;
            subexp.factors = [{operator: operator, expression: secondFactor}];
            
            sum.expression = subexp;
          }
          ex.summands.push(sum);
        }
        
        return ex;
      },
      peg$c322 = function(exp, exps) {
        if(exps.length === 0) {
          return exp;
        }
        
        var ex = {};
        ex.token = 'expression';
        ex.expressionType = 'multiplicativeexpression';
        ex.factor = exp;
        ex.factors = [];
        for(var i=0; i<exps.length; i++) {
          var factor = exps[i];
          var fact = {};
          fact.operator = factor[1];
          fact.expression = factor[3];
          ex.factors.push(fact);
        }
        
        return ex;
      },
      peg$c323 = function(e) {
        var ex = {};
        ex.token = 'expression';
        ex.expressionType = 'unaryexpression';
        ex.unaryexpression = "!";
        ex.expression = e;

        return ex;
      },
      peg$c324 = function(v) {
        var ex = {};
        ex.token = 'expression';
        ex.expressionType = 'unaryexpression';
        ex.unaryexpression = "+";
        ex.expression = v;

        return ex;
      },
      peg$c325 = function(v) {
        var ex = {};
        ex.token = 'expression';
        ex.expressionType = 'unaryexpression';
        ex.unaryexpression = "-";
        ex.expression = v;

        return ex;
      },
      peg$c326 = function(v) {
        var ex = {};
        ex.token = 'expression';
        ex.expressionType = 'atomic';
        ex.primaryexpression = 'rdfliteral';
        ex.value = v;

        return ex;
      },
      peg$c327 = function(v) {
        var ex = {};
        ex.token = 'expression';
        ex.expressionType = 'atomic';
        ex.primaryexpression = 'numericliteral';
        ex.value = v;

        return ex;
      },
      peg$c328 = function(v) {
        var ex = {};
        ex.token = 'expression';
        ex.expressionType = 'atomic';
        ex.primaryexpression = 'booleanliteral';
        ex.value = v;

        return ex;
      },
      peg$c329 = function(v) {
        var ex = {};
        ex.token = 'expression';
        ex.expressionType = 'atomic';
        ex.primaryexpression = 'var';
        ex.value = v;

        return ex;
      },
      peg$c330 = function(e) {
        return e;
      },
      peg$c331 = "STR",
      peg$c332 = peg$literalExpectation("STR", false),
      peg$c333 = "str",
      peg$c334 = peg$literalExpectation("str", false),
      peg$c335 = function(e) {
        var ex = {};
        ex.token = 'expression'
        ex.expressionType = 'builtincall'
        ex.builtincall = 'str'
        ex.args = [e]
        
        return ex;
      },
      peg$c336 = "LANG",
      peg$c337 = peg$literalExpectation("LANG", false),
      peg$c338 = "lang",
      peg$c339 = peg$literalExpectation("lang", false),
      peg$c340 = function(e) {
        var ex = {};
        ex.token = 'expression'
        ex.expressionType = 'builtincall'
        ex.builtincall = 'lang'
        ex.args = [e]
        
        return ex;
      },
      peg$c341 = "LANGMATCHES",
      peg$c342 = peg$literalExpectation("LANGMATCHES", false),
      peg$c343 = "langmatches",
      peg$c344 = peg$literalExpectation("langmatches", false),
      peg$c345 = function(e1, e2) {
        var ex = {};
        ex.token = 'expression'
        ex.expressionType = 'builtincall'
        ex.builtincall = 'langmatches'
        ex.args = [e1,e2]
        
        return ex;
      },
      peg$c346 = "DATATYPE",
      peg$c347 = peg$literalExpectation("DATATYPE", false),
      peg$c348 = "datatype",
      peg$c349 = peg$literalExpectation("datatype", false),
      peg$c350 = function(e) {
        var ex = {};
        ex.token = 'expression'
        ex.expressionType = 'builtincall'
        ex.builtincall = 'datatype'
        ex.args = [e]
        
        return ex;
      },
      peg$c351 = "BOUND",
      peg$c352 = peg$literalExpectation("BOUND", false),
      peg$c353 = "bound",
      peg$c354 = peg$literalExpectation("bound", false),
      peg$c355 = function(v) {
        var ex = {};
        ex.token = 'expression'
        ex.expressionType = 'builtincall'
        ex.builtincall = 'bound'
        ex.args = [v]

        return ex;
      },
      peg$c356 = "IRI",
      peg$c357 = peg$literalExpectation("IRI", false),
      peg$c358 = "iri",
      peg$c359 = peg$literalExpectation("iri", false),
      peg$c360 = function(e) {
        var ex = {};
        ex.token = 'expression';
        ex.expressionType = 'builtincall';
        ex.builtincall = 'iri'
        ex.args = [e];

        return ex;
      },
      peg$c361 = "URI",
      peg$c362 = peg$literalExpectation("URI", false),
      peg$c363 = "uri",
      peg$c364 = peg$literalExpectation("uri", false),
      peg$c365 = function(e) {
        var ex = {};
        ex.token = 'expression';
        ex.expressionType = 'builtincall';
        ex.builtincall = 'uri'
        ex.args = [e];

        return ex;
      },
      peg$c366 = "BNODE",
      peg$c367 = peg$literalExpectation("BNODE", false),
      peg$c368 = "bnode",
      peg$c369 = peg$literalExpectation("bnode", false),
      peg$c370 = function(arg) {
        var ex = {};
        ex.token = 'expression';
        ex.expressionType = 'builtincall';
        ex.builtincall = 'bnode';
        if(arg.length === 5) {
          ex.args = [arg[2]];
        } else {
          ex.args = null;
        }

        return ex;
      },
      peg$c371 = "COALESCE",
      peg$c372 = peg$literalExpectation("COALESCE", false),
      peg$c373 = "coalesce",
      peg$c374 = peg$literalExpectation("coalesce", false),
      peg$c375 = function(args) {
        var ex = {};
        ex.token = 'expression';
        ex.expressionType = 'builtincall';
        ex.builtincall = 'coalesce';
        ex.args = args;

        return ex;
      },
      peg$c376 = "IF",
      peg$c377 = peg$literalExpectation("IF", false),
      peg$c378 = "if",
      peg$c379 = peg$literalExpectation("if", false),
      peg$c380 = function(test, trueCond, falseCond) {
        var ex = {};
        ex.token = 'expression';
        ex.expressionType = 'builtincall';
        ex.builtincall = 'if';
        ex.args = [test,trueCond,falseCond];

        return ex;
      },
      peg$c381 = "ISLITERAL",
      peg$c382 = peg$literalExpectation("ISLITERAL", false),
      peg$c383 = "isliteral",
      peg$c384 = peg$literalExpectation("isliteral", false),
      peg$c385 = "isLITERAL",
      peg$c386 = peg$literalExpectation("isLITERAL", false),
      peg$c387 = function(arg) {
        var ex = {};
        ex.token = 'expression';
        ex.expressionType = 'builtincall';
        ex.builtincall = 'isliteral';
        ex.args = [arg];

        return ex;
      },
      peg$c388 = "ISBLANK",
      peg$c389 = peg$literalExpectation("ISBLANK", false),
      peg$c390 = "isblank",
      peg$c391 = peg$literalExpectation("isblank", false),
      peg$c392 = "isBLANK",
      peg$c393 = peg$literalExpectation("isBLANK", false),
      peg$c394 = function(arg) {
        var ex = {};
        ex.token = 'expression';
        ex.expressionType = 'builtincall';
        ex.builtincall = 'isblank';
        ex.args = [arg];

        return ex;
      },
      peg$c395 = "SAMETERM",
      peg$c396 = peg$literalExpectation("SAMETERM", false),
      peg$c397 = "sameterm",
      peg$c398 = peg$literalExpectation("sameterm", false),
      peg$c399 = function(e1, e2) {
        var ex = {};
        ex.token = 'expression';
        ex.expressionType = 'builtincall';
        ex.builtincall = 'sameterm';
        ex.args = [e1, e2];
        return ex;
      },
      peg$c400 = "ISURI",
      peg$c401 = peg$literalExpectation("ISURI", false),
      peg$c402 = "isuri",
      peg$c403 = peg$literalExpectation("isuri", false),
      peg$c404 = "isURI",
      peg$c405 = peg$literalExpectation("isURI", false),
      peg$c406 = "ISIRI",
      peg$c407 = peg$literalExpectation("ISIRI", false),
      peg$c408 = "isiri",
      peg$c409 = peg$literalExpectation("isiri", false),
      peg$c410 = "isIRI",
      peg$c411 = peg$literalExpectation("isIRI", false),
      peg$c412 = function(arg) {
        var ex = {};
        ex.token = 'expression';
        ex.expressionType = 'builtincall';
        ex.builtincall = 'isuri';
        ex.args = [arg];

        return ex;
      },
      peg$c413 = "custom:",
      peg$c414 = peg$literalExpectation("custom:", false),
      peg$c415 = "CUSTOM:",
      peg$c416 = peg$literalExpectation("CUSTOM:", false),
      peg$c417 = /^[a-zA-Z0-9_]/,
      peg$c418 = peg$classExpectation([["a", "z"], ["A", "Z"], ["0", "9"], "_"], false, false),
      peg$c419 = function(fnname, alter, finalarg) {
        var ex = {};
        ex.token = 'expression';
        ex.expressionType = 'custom';
        ex.name = fnname.join('');
        var acum = [];
        for(var i=0; i<alter.length; i++)
          acum.push(alter[i][1]);
        acum.push(finalarg);
        ex.args = acum;

        return ex;
      },
      peg$c420 = "REGEX",
      peg$c421 = peg$literalExpectation("REGEX", false),
      peg$c422 = "regex",
      peg$c423 = peg$literalExpectation("regex", false),
      peg$c424 = function(e1, e2, eo) {
        var regex = {};
        regex.token = 'expression';
        regex.expressionType = 'regex';
        regex.text = e1;
        regex.pattern = e2;
        if(eo != null) {
          regex.flags = eo[2];
        }
        
        return regex;
      },
      peg$c425 = "EXISTS",
      peg$c426 = peg$literalExpectation("EXISTS", false),
      peg$c427 = "exists",
      peg$c428 = peg$literalExpectation("exists", false),
      peg$c429 = function(ggp) {
        var ex = {};
        ex.token = 'expression';
        ex.expressionType = 'builtincall';
        ex.builtincall = 'exists';
        ex.args = [ggp];
        
        return ex;
      },
      peg$c430 = "NOT",
      peg$c431 = peg$literalExpectation("NOT", false),
      peg$c432 = "not",
      peg$c433 = peg$literalExpectation("not", false),
      peg$c434 = function(ggp) {
        var ex = {};
        ex.token = 'expression';
        ex.expressionType = 'builtincall';
        ex.builtincall = 'notexists';
        ex.args = [ggp];
        
        return ex;
      },
      peg$c435 = "COUNT",
      peg$c436 = peg$literalExpectation("COUNT", false),
      peg$c437 = "count",
      peg$c438 = peg$literalExpectation("count", false),
      peg$c439 = function(d, e) {
        var exp = {};
        exp.token = 'expression';
        exp.expressionType = 'aggregate';
        exp.aggregateType = 'count';
        exp.distinct = ((d != "" && d != null) ? 'DISTINCT' : d);
        exp.expression = e;
        
        return exp;
      },
      peg$c440 = "GROUP_CONCAT",
      peg$c441 = peg$literalExpectation("GROUP_CONCAT", false),
      peg$c442 = "group_concat",
      peg$c443 = peg$literalExpectation("group_concat", false),
      peg$c444 = "SEPARATOR",
      peg$c445 = peg$literalExpectation("SEPARATOR", false),
      peg$c446 = function(d, e, s) {
        var exp = {};
        exp.token = 'expression';
        exp.expressionType = 'aggregate';
        exp.aggregateType = 'group_concat';
        exp.distinct = ((d != "" && d != null) ? 'DISTINCT' : d);
        exp.expression = e;
        exp.separator = s;
        
        return exp;
      },
      peg$c447 = "SUM",
      peg$c448 = peg$literalExpectation("SUM", false),
      peg$c449 = "sum",
      peg$c450 = peg$literalExpectation("sum", false),
      peg$c451 = function(d, e) {
        var exp = {};
        exp.token = 'expression';
        exp.expressionType = 'aggregate';
        exp.aggregateType = 'sum';
        exp.distinct = ((d != "" && d != null) ? 'DISTINCT' : d);
        exp.expression = e;
        
        return exp;
      },
      peg$c452 = "MIN",
      peg$c453 = peg$literalExpectation("MIN", false),
      peg$c454 = "min",
      peg$c455 = peg$literalExpectation("min", false),
      peg$c456 = function(d, e) {
        var exp = {};
        exp.token = 'expression';
        exp.expressionType = 'aggregate';
        exp.aggregateType = 'min';
        exp.distinct = ((d != "" && d != null) ? 'DISTINCT' : d);
        exp.expression = e;
        
        return exp;
      },
      peg$c457 = "MAX",
      peg$c458 = peg$literalExpectation("MAX", false),
      peg$c459 = "max",
      peg$c460 = peg$literalExpectation("max", false),
      peg$c461 = function(d, e) {
        var exp = {};
        exp.token = 'expression'
        exp.expressionType = 'aggregate'
        exp.aggregateType = 'max'
        exp.distinct = ((d != "" && d != null) ? 'DISTINCT' : d);
        exp.expression = e
        
        return exp
      },
      peg$c462 = "AVG",
      peg$c463 = peg$literalExpectation("AVG", false),
      peg$c464 = "avg",
      peg$c465 = peg$literalExpectation("avg", false),
      peg$c466 = function(d, e) {
        var exp = {};
        exp.token = 'expression'
        exp.expressionType = 'aggregate'
        exp.aggregateType = 'avg'
        exp.distinct = ((d != "" && d != null) ? 'DISTINCT' : d);
        exp.expression = e
        
        return exp
      },
      peg$c467 = function(i, args) {
        var fcall = {};
        fcall.token = "expression";
        fcall.expressionType = 'irireforfunction';
        fcall.iriref = i;
        fcall.args = (args != null ? args.value : args);
        
        return fcall;
      },
      peg$c468 = "^^",
      peg$c469 = peg$literalExpectation("^^", false),
      peg$c470 = function(s, e) {
        if(typeof(e) === "string" && e.length > 0) {
          return {token:'literal', value:s.value, lang:e.slice(1), type:null,  location: location()}
        } else {
          if(e != null && typeof(e) === "object") {
            e.shift(); // remove the '^^' char
            return {token:'literal', value:s.value, lang:null, type:e[0],  location: location()}
          } else {
            return { token:'literal', value:s.value, lang:null, type:null,  location: location() }
          }
        }
      },
      peg$c471 = "TRUE",
      peg$c472 = peg$literalExpectation("TRUE", false),
      peg$c473 = "true",
      peg$c474 = peg$literalExpectation("true", false),
      peg$c475 = function() {
        var lit = {};
        lit.token = "literal";
        lit.lang = null;
        lit.type = "http://www.w3.org/2001/XMLSchema#boolean";
        lit.value = true;
        return lit;
      },
      peg$c476 = "FALSE",
      peg$c477 = peg$literalExpectation("FALSE", false),
      peg$c478 = "false",
      peg$c479 = peg$literalExpectation("false", false),
      peg$c480 = function() {
        var lit = {};
        lit.token = "literal";
        lit.lang = null;
        lit.type = "http://www.w3.org/2001/XMLSchema#boolean";
        lit.value = false;
        return lit;
      },
      peg$c481 = function(s) {
        return {token:'string', value:s,  location: location()}
      },
      peg$c482 = function(s) {
        return {token:'string', value:s, location: location()}
      },
      peg$c483 = function(iri) {
        return {token: 'uri', prefix:null, suffix:null, value:iri, location: location()}
      },
      peg$c484 = function(p) {
        return p
      },
      peg$c485 = function(p) {
        return {token: 'uri', prefix:p[0], suffix:p[1], value:null, location: location() }
      },
      peg$c486 = function(p) {
        return {token: 'uri', prefix:p, suffix:'', value:null, location: location() }
      },
      peg$c487 = function(l) {
        return {token:'blank', value:l, location: location()}
      },
      peg$c488 = function() { 
        GlobalBlankNodeCounter++;
        return {token:'blank', value:'_:'+GlobalBlankNodeCounter, location: location()}
      },
      peg$c489 = /^[^<>"{}|\^`\\]/,
      peg$c490 = peg$classExpectation(["<", ">", "\"", "{", "}", "|", "^", "`", "\\"], true, false),
      peg$c491 = function(iri_ref) { return iri_ref.join('') },
      peg$c492 = ":",
      peg$c493 = peg$literalExpectation(":", false),
      peg$c494 = function(p, s) {
        return [p, s]
      },
      peg$c495 = "_:",
      peg$c496 = peg$literalExpectation("_:", false),
      peg$c497 = function(l) {
        return l
      },
      peg$c498 = function(v) {
        // return v
        return { prefix: "?",  value: v };
      },
      peg$c499 = "$",
      peg$c500 = peg$literalExpectation("$", false),
      peg$c501 = function(v) {
        // return v
        return { prefix: "$",  value: v };
      },
      peg$c502 = "{{",
      peg$c503 = peg$literalExpectation("{{", false),
      peg$c504 = "}}",
      peg$c505 = peg$literalExpectation("}}", false),
      peg$c506 = function(v) {
        return { prefix: 'mustash',  value: v };
      },
      peg$c507 = "@",
      peg$c508 = peg$literalExpectation("@", false),
      peg$c509 = /^[a-zA-Z]/,
      peg$c510 = peg$classExpectation([["a", "z"], ["A", "Z"]], false, false),
      peg$c511 = /^[a-zA-Z0-9]/,
      peg$c512 = peg$classExpectation([["a", "z"], ["A", "Z"], ["0", "9"]], false, false),
      peg$c513 = function(a, b) {
        if(b.length===0) {
          return ("@"+a.join('')).toLowerCase();
        } else {
          return ("@"+a.join('')+"-"+b[0][1].join('')).toLowerCase();
        }
      },
      peg$c514 = /^[0-9]/,
      peg$c515 = peg$classExpectation([["0", "9"]], false, false),
      peg$c516 = function(d) {
        var lit = {};
        lit.token = "literal";
        lit.lang = null;
        lit.type = "http://www.w3.org/2001/XMLSchema#integer";
        lit.value = flattenString(d);
        return lit;
      },
      peg$c517 = function(a, b, c) {
        var lit = {};
        lit.token = "literal";
        lit.lang = null;
        lit.type = "http://www.w3.org/2001/XMLSchema#decimal";
        lit.value = flattenString([a,b,c]);
        return lit;
      },
      peg$c518 = function(a, b) {
        var lit = {};
        lit.token = "literal";
        lit.lang = null;
        lit.type = "http://www.w3.org/2001/XMLSchema#decimal";
        lit.value = flattenString([a,b]);
        return lit;
      },
      peg$c519 = function(a, b, c, e) {
        var lit = {};
        lit.token = "literal";
        lit.lang = null;
        lit.type = "http://www.w3.org/2001/XMLSchema#double";
        lit.value = flattenString([a,b,c,e]);
        return lit;
      },
      peg$c520 = function(a, b, c) {
        var lit = {};
        lit.token = "literal";
        lit.lang = null;
        lit.type = "http://www.w3.org/2001/XMLSchema#double";
        lit.value = flattenString([a,b,c]);
        return lit;
      },
      peg$c521 = function(a, b) {
        var lit = {};
        lit.token = "literal";
        lit.lang = null;
        lit.type = "http://www.w3.org/2001/XMLSchema#double";
        lit.value = flattenString([a,b]);
        return lit;
      },
      peg$c522 = function(d) {
        d.value = "+" + d.value;
        return d;
      },
      peg$c523 = function(d) { d.value = "+"+d.value; return d },
      peg$c524 = function(d) { d.value = "-"+d.value; return d; },
      peg$c525 = /^[eE]/,
      peg$c526 = peg$classExpectation(["e", "E"], false, false),
      peg$c527 = /^[+\-]/,
      peg$c528 = peg$classExpectation(["+", "-"], false, false),
      peg$c529 = function(a, b, c) { return flattenString([a,b,c]) },
      peg$c530 = "'",
      peg$c531 = peg$literalExpectation("'", false),
      peg$c532 = /^[^'\\\n\r]/,
      peg$c533 = peg$classExpectation(["'", "\\", "\n", "\r"], true, false),
      peg$c534 = function(content) { return flattenString(content) },
      peg$c535 = "\"",
      peg$c536 = peg$literalExpectation("\"", false),
      peg$c537 = /^[^"\\\n\r]/,
      peg$c538 = peg$classExpectation(["\"", "\\", "\n", "\r"], true, false),
      peg$c539 = "'''",
      peg$c540 = peg$literalExpectation("'''", false),
      peg$c541 = /^[^'\\]/,
      peg$c542 = peg$classExpectation(["'", "\\"], true, false),
      peg$c543 = "\"\"\"",
      peg$c544 = peg$literalExpectation("\"\"\"", false),
      peg$c545 = /^[^"\\]/,
      peg$c546 = peg$classExpectation(["\"", "\\"], true, false),
      peg$c547 = "\\",
      peg$c548 = peg$literalExpectation("\\", false),
      peg$c549 = /^[tbnrf"']/,
      peg$c550 = peg$classExpectation(["t", "b", "n", "r", "f", "\"", "'"], false, false),
      peg$c551 = function() {
        return {
          token: "triplesnodecollection",
          location: location(),
          triplesContext:[],
          chainSubject:[{token:'uri', value:"http://www.w3.org/1999/02/22-rdf-syntax-ns#nil"}]};
      },
      peg$c552 = /^[ ]/,
      peg$c553 = peg$classExpectation([" "], false, false),
      peg$c554 = /^[\t]/,
      peg$c555 = peg$classExpectation(["\t"], false, false),
      peg$c556 = /^[\r]/,
      peg$c557 = peg$classExpectation(["\r"], false, false),
      peg$c558 = /^[\n]/,
      peg$c559 = peg$classExpectation(["\n"], false, false),
      peg$c560 = /^[\n\r]/,
      peg$c561 = peg$classExpectation(["\n", "\r"], false, false),
      peg$c562 = /^[^\n\r]/,
      peg$c563 = peg$classExpectation(["\n", "\r"], true, false),
      peg$c564 = "#",
      peg$c565 = peg$literalExpectation("#", false),
      peg$c566 = function(h) {
        return flattenString(h);
      },
      peg$c567 = function(comment) {
        var loc = location().start.line;
        var str = flattenString(comment).trim()
        CommentsHash[loc] = str;

        return '';
      },
      peg$c568 = /^[A-Z]/,
      peg$c569 = peg$classExpectation([["A", "Z"]], false, false),
      peg$c570 = /^[a-z]/,
      peg$c571 = peg$classExpectation([["a", "z"]], false, false),
      peg$c572 = /^[\xC0-\xD6]/,
      peg$c573 = peg$classExpectation([["\xC0", "\xD6"]], false, false),
      peg$c574 = /^[\xD8-\xF6]/,
      peg$c575 = peg$classExpectation([["\xD8", "\xF6"]], false, false),
      peg$c576 = /^[\xF8-\u02FF]/,
      peg$c577 = peg$classExpectation([["\xF8", "\u02FF"]], false, false),
      peg$c578 = /^[\u0370-\u037D]/,
      peg$c579 = peg$classExpectation([["\u0370", "\u037D"]], false, false),
      peg$c580 = /^[\u037F-\u1FFF]/,
      peg$c581 = peg$classExpectation([["\u037F", "\u1FFF"]], false, false),
      peg$c582 = /^[\u200C-\u200D]/,
      peg$c583 = peg$classExpectation([["\u200C", "\u200D"]], false, false),
      peg$c584 = /^[\u2070-\u218F]/,
      peg$c585 = peg$classExpectation([["\u2070", "\u218F"]], false, false),
      peg$c586 = /^[\u2C00-\u2FEF]/,
      peg$c587 = peg$classExpectation([["\u2C00", "\u2FEF"]], false, false),
      peg$c588 = /^[\u3001-\uD7FF]/,
      peg$c589 = peg$classExpectation([["\u3001", "\uD7FF"]], false, false),
      peg$c590 = /^[\uF900-\uFDCF]/,
      peg$c591 = peg$classExpectation([["\uF900", "\uFDCF"]], false, false),
      peg$c592 = /^[\uFDF0-\uFFFD]/,
      peg$c593 = peg$classExpectation([["\uFDF0", "\uFFFD"]], false, false),
      peg$c594 = /^[\u1000-\uEFFF]/,
      peg$c595 = peg$classExpectation([["\u1000", "\uEFFF"]], false, false),
      peg$c596 = "_",
      peg$c597 = peg$literalExpectation("_", false),
      peg$c598 = /^[\xB7]/,
      peg$c599 = peg$classExpectation(["\xB7"], false, false),
      peg$c600 = /^[\u0300-\u036F]/,
      peg$c601 = peg$classExpectation([["\u0300", "\u036F"]], false, false),
      peg$c602 = /^[\u203F-\u2040]/,
      peg$c603 = peg$classExpectation([["\u203F", "\u2040"]], false, false),
      peg$c604 = function(init, rpart) { return init+rpart.join('') },
      peg$c605 = function(base, rest) { 
        if(rest[rest.length-1] == '.'){
          throw new Error("Wrong PN_PREFIX, cannot finish with '.'")
        } else {
          return base + rest.join('');
        }
      },
      peg$c606 = function(base, rest) {
        return base + (rest||[]).join('');
      },
      peg$c607 = "%",
      peg$c608 = peg$literalExpectation("%", false),
      peg$c609 = function(h) {
        return h.join("");
      },
      peg$c610 = /^[A-F]/,
      peg$c611 = peg$classExpectation([["A", "F"]], false, false),
      peg$c612 = /^[a-f]/,
      peg$c613 = peg$classExpectation([["a", "f"]], false, false),
      peg$c614 = "~",
      peg$c615 = peg$literalExpectation("~", false),
      peg$c616 = "&",
      peg$c617 = peg$literalExpectation("&", false),
      peg$c618 = function(c) {
        return "\\"+c;
      },

      peg$currPos          = 0,
      peg$savedPos         = 0,
      peg$posDetailsCache  = [{ line: 1, column: 1 }],
      peg$maxFailPos       = 0,
      peg$maxFailExpected  = [],
      peg$silentFails      = 0,

      peg$result;

  if ("startRule" in options) {
    if (!(options.startRule in peg$startRuleFunctions)) {
      throw new Error("Can't start parsing from rule \"" + options.startRule + "\".");
    }

    peg$startRuleFunction = peg$startRuleFunctions[options.startRule];
  }

  function text() {
    return input.substring(peg$savedPos, peg$currPos);
  }

  function location() {
    return peg$computeLocation(peg$savedPos, peg$currPos);
  }

  function expected(description, location) {
    location = location !== void 0 ? location : peg$computeLocation(peg$savedPos, peg$currPos)

    throw peg$buildStructuredError(
      [peg$otherExpectation(description)],
      input.substring(peg$savedPos, peg$currPos),
      location
    );
  }

  function error(message, location) {
    location = location !== void 0 ? location : peg$computeLocation(peg$savedPos, peg$currPos)

    throw peg$buildSimpleError(message, location);
  }

  function peg$literalExpectation(text, ignoreCase) {
    return { type: "literal", text: text, ignoreCase: ignoreCase };
  }

  function peg$classExpectation(parts, inverted, ignoreCase) {
    return { type: "class", parts: parts, inverted: inverted, ignoreCase: ignoreCase };
  }

  function peg$anyExpectation() {
    return { type: "any" };
  }

  function peg$endExpectation() {
    return { type: "end" };
  }

  function peg$otherExpectation(description) {
    return { type: "other", description: description };
  }

  function peg$computePosDetails(pos) {
    var details = peg$posDetailsCache[pos], p;

    if (details) {
      return details;
    } else {
      p = pos - 1;
      while (!peg$posDetailsCache[p]) {
        p--;
      }

      details = peg$posDetailsCache[p];
      details = {
        line:   details.line,
        column: details.column
      };

      while (p < pos) {
        if (input.charCodeAt(p) === 10) {
          details.line++;
          details.column = 1;
        } else {
          details.column++;
        }

        p++;
      }

      peg$posDetailsCache[pos] = details;
      return details;
    }
  }

  function peg$computeLocation(startPos, endPos) {
    var startPosDetails = peg$computePosDetails(startPos),
        endPosDetails   = peg$computePosDetails(endPos);

    return {
      start: {
        offset: startPos,
        line:   startPosDetails.line,
        column: startPosDetails.column
      },
      end: {
        offset: endPos,
        line:   endPosDetails.line,
        column: endPosDetails.column
      }
    };
  }

  function peg$fail(expected) {
    if (peg$currPos < peg$maxFailPos) { return; }

    if (peg$currPos > peg$maxFailPos) {
      peg$maxFailPos = peg$currPos;
      peg$maxFailExpected = [];
    }

    peg$maxFailExpected.push(expected);
  }

  function peg$buildSimpleError(message, location) {
    return new peg$SyntaxError(message, null, null, location);
  }

  function peg$buildStructuredError(expected, found, location) {
    return new peg$SyntaxError(
      peg$SyntaxError.buildMessage(expected, found),
      expected,
      found,
      location
    );
  }

  function peg$parseDOCUMENT() {
    var s0;

    s0 = peg$parseSPARQL();

    return s0;
  }

  function peg$parseSPARQL() {
    var s0;

    s0 = peg$parseQuery();
    if (s0 === peg$FAILED) {
      s0 = peg$parseUpdate();
    }

    return s0;
  }

  function peg$parseQuery() {
    var s0, s1, s2, s3, s4, s5, s6, s7, s8, s9, s10;

    s0 = peg$currPos;
    s1 = [];
    s2 = peg$parseHEADER_LINE();
    while (s2 !== peg$FAILED) {
      s1.push(s2);
      s2 = peg$parseHEADER_LINE();
    }
    if (s1 !== peg$FAILED) {
      s2 = [];
      s3 = peg$parseWS();
      while (s3 !== peg$FAILED) {
        s2.push(s3);
        s3 = peg$parseWS();
      }
      if (s2 !== peg$FAILED) {
        s3 = peg$parsePrologue();
        if (s3 !== peg$FAILED) {
          s4 = [];
          s5 = peg$parseWS();
          while (s5 !== peg$FAILED) {
            s4.push(s5);
            s5 = peg$parseWS();
          }
          if (s4 !== peg$FAILED) {
            s5 = [];
            s6 = peg$parseFunction();
            while (s6 !== peg$FAILED) {
              s5.push(s6);
              s6 = peg$parseFunction();
            }
            if (s5 !== peg$FAILED) {
              s6 = [];
              s7 = peg$parseWS();
              while (s7 !== peg$FAILED) {
                s6.push(s7);
                s7 = peg$parseWS();
              }
              if (s6 !== peg$FAILED) {
                s7 = peg$parseSelectQuery();
                if (s7 === peg$FAILED) {
                  s7 = peg$parseConstructQuery();
                  if (s7 === peg$FAILED) {
                    s7 = peg$parseDescribeQuery();
                    if (s7 === peg$FAILED) {
                      s7 = peg$parseAskQuery();
                    }
                  }
                }
                if (s7 !== peg$FAILED) {
                  s8 = peg$parseValuesClause();
                  if (s8 !== peg$FAILED) {
                    s9 = [];
                    s10 = peg$parseWS();
                    while (s10 !== peg$FAILED) {
                      s9.push(s10);
                      s10 = peg$parseWS();
                    }
                    if (s9 !== peg$FAILED) {
                      peg$savedPos = s0;
                      s1 = peg$c0(s1, s3, s5, s7, s8);
                      s0 = s1;
                    } else {
                      peg$currPos = s0;
                      s0 = peg$FAILED;
                    }
                  } else {
                    peg$currPos = s0;
                    s0 = peg$FAILED;
                  }
                } else {
                  peg$currPos = s0;
                  s0 = peg$FAILED;
                }
              } else {
                peg$currPos = s0;
                s0 = peg$FAILED;
              }
            } else {
              peg$currPos = s0;
              s0 = peg$FAILED;
            }
          } else {
            peg$currPos = s0;
            s0 = peg$FAILED;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }

    return s0;
  }

  function peg$parseFunction() {
    var s0, s1, s2, s3, s4, s5;

    s0 = peg$currPos;
    s1 = peg$parseFunctionCall();
    if (s1 !== peg$FAILED) {
      s2 = [];
      s3 = peg$parseWS();
      while (s3 !== peg$FAILED) {
        s2.push(s3);
        s3 = peg$parseWS();
      }
      if (s2 !== peg$FAILED) {
        s3 = peg$parseGroupGraphPattern();
        if (s3 !== peg$FAILED) {
          s4 = [];
          s5 = peg$parseWS();
          while (s5 !== peg$FAILED) {
            s4.push(s5);
            s5 = peg$parseWS();
          }
          if (s4 !== peg$FAILED) {
            peg$savedPos = s0;
            s1 = peg$c1(s1, s3);
            s0 = s1;
          } else {
            peg$currPos = s0;
            s0 = peg$FAILED;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }

    return s0;
  }

  function peg$parsePrologue() {
    var s0, s1, s2, s3, s4;

    s0 = peg$currPos;
    s1 = peg$parseBaseDecl();
    if (s1 === peg$FAILED) {
      s1 = null;
    }
    if (s1 !== peg$FAILED) {
      s2 = [];
      s3 = peg$parseWS();
      while (s3 !== peg$FAILED) {
        s2.push(s3);
        s3 = peg$parseWS();
      }
      if (s2 !== peg$FAILED) {
        s3 = [];
        s4 = peg$parsePrefixDecl();
        while (s4 !== peg$FAILED) {
          s3.push(s4);
          s4 = peg$parsePrefixDecl();
        }
        if (s3 !== peg$FAILED) {
          peg$savedPos = s0;
          s1 = peg$c2(s1, s3);
          s0 = s1;
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }

    return s0;
  }

  function peg$parseBaseDecl() {
    var s0, s1, s2, s3, s4;

    s0 = peg$currPos;
    s1 = [];
    s2 = peg$parseWS();
    while (s2 !== peg$FAILED) {
      s1.push(s2);
      s2 = peg$parseWS();
    }
    if (s1 !== peg$FAILED) {
      if (input.substr(peg$currPos, 4) === peg$c3) {
        s2 = peg$c3;
        peg$currPos += 4;
      } else {
        s2 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c4); }
      }
      if (s2 === peg$FAILED) {
        if (input.substr(peg$currPos, 4) === peg$c5) {
          s2 = peg$c5;
          peg$currPos += 4;
        } else {
          s2 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c6); }
        }
      }
      if (s2 !== peg$FAILED) {
        s3 = [];
        s4 = peg$parseWS();
        while (s4 !== peg$FAILED) {
          s3.push(s4);
          s4 = peg$parseWS();
        }
        if (s3 !== peg$FAILED) {
          s4 = peg$parseIRI_REF();
          if (s4 !== peg$FAILED) {
            peg$savedPos = s0;
            s1 = peg$c7(s4);
            s0 = s1;
          } else {
            peg$currPos = s0;
            s0 = peg$FAILED;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }

    return s0;
  }

  function peg$parsePrefixDecl() {
    var s0, s1, s2, s3, s4, s5, s6;

    s0 = peg$currPos;
    s1 = [];
    s2 = peg$parseWS();
    while (s2 !== peg$FAILED) {
      s1.push(s2);
      s2 = peg$parseWS();
    }
    if (s1 !== peg$FAILED) {
      if (input.substr(peg$currPos, 6) === peg$c8) {
        s2 = peg$c8;
        peg$currPos += 6;
      } else {
        s2 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c9); }
      }
      if (s2 === peg$FAILED) {
        if (input.substr(peg$currPos, 6) === peg$c10) {
          s2 = peg$c10;
          peg$currPos += 6;
        } else {
          s2 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c11); }
        }
      }
      if (s2 !== peg$FAILED) {
        s3 = [];
        s4 = peg$parseWS();
        while (s4 !== peg$FAILED) {
          s3.push(s4);
          s4 = peg$parseWS();
        }
        if (s3 !== peg$FAILED) {
          s4 = peg$parsePNAME_NS();
          if (s4 !== peg$FAILED) {
            s5 = [];
            s6 = peg$parseWS();
            while (s6 !== peg$FAILED) {
              s5.push(s6);
              s6 = peg$parseWS();
            }
            if (s5 !== peg$FAILED) {
              s6 = peg$parseIRI_REF();
              if (s6 !== peg$FAILED) {
                peg$savedPos = s0;
                s1 = peg$c12(s4, s6);
                s0 = s1;
              } else {
                peg$currPos = s0;
                s0 = peg$FAILED;
              }
            } else {
              peg$currPos = s0;
              s0 = peg$FAILED;
            }
          } else {
            peg$currPos = s0;
            s0 = peg$FAILED;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }

    return s0;
  }

  function peg$parseSelectQuery() {
    var s0, s1, s2, s3, s4, s5, s6, s7, s8, s9;

    s0 = peg$currPos;
    s1 = peg$parseSelectClause();
    if (s1 !== peg$FAILED) {
      s2 = [];
      s3 = peg$parseWS();
      while (s3 !== peg$FAILED) {
        s2.push(s3);
        s3 = peg$parseWS();
      }
      if (s2 !== peg$FAILED) {
        s3 = [];
        s4 = peg$parseDatasetClause();
        while (s4 !== peg$FAILED) {
          s3.push(s4);
          s4 = peg$parseDatasetClause();
        }
        if (s3 !== peg$FAILED) {
          s4 = [];
          s5 = peg$parseWS();
          while (s5 !== peg$FAILED) {
            s4.push(s5);
            s5 = peg$parseWS();
          }
          if (s4 !== peg$FAILED) {
            s5 = peg$parseWhereClause();
            if (s5 !== peg$FAILED) {
              s6 = [];
              s7 = peg$parseWS();
              while (s7 !== peg$FAILED) {
                s6.push(s7);
                s7 = peg$parseWS();
              }
              if (s6 !== peg$FAILED) {
                s7 = peg$parseSolutionModifier();
                if (s7 !== peg$FAILED) {
                  s8 = [];
                  s9 = peg$parseWS();
                  while (s9 !== peg$FAILED) {
                    s8.push(s9);
                    s9 = peg$parseWS();
                  }
                  if (s8 !== peg$FAILED) {
                    s9 = peg$parseBindingsClause();
                    if (s9 !== peg$FAILED) {
                      peg$savedPos = s0;
                      s1 = peg$c13(s1, s3, s5, s7);
                      s0 = s1;
                    } else {
                      peg$currPos = s0;
                      s0 = peg$FAILED;
                    }
                  } else {
                    peg$currPos = s0;
                    s0 = peg$FAILED;
                  }
                } else {
                  peg$currPos = s0;
                  s0 = peg$FAILED;
                }
              } else {
                peg$currPos = s0;
                s0 = peg$FAILED;
              }
            } else {
              peg$currPos = s0;
              s0 = peg$FAILED;
            }
          } else {
            peg$currPos = s0;
            s0 = peg$FAILED;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }

    return s0;
  }

  function peg$parseSubSelect() {
    var s0, s1, s2, s3;

    s0 = peg$currPos;
    s1 = peg$parseSelectClause();
    if (s1 !== peg$FAILED) {
      s2 = peg$parseWhereClause();
      if (s2 !== peg$FAILED) {
        s3 = peg$parseSolutionModifier();
        if (s3 !== peg$FAILED) {
          peg$savedPos = s0;
          s1 = peg$c14(s1, s2, s3);
          s0 = s1;
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }

    return s0;
  }

  function peg$parseSelectClause() {
    var s0, s1, s2, s3, s4, s5, s6, s7, s8, s9, s10, s11, s12, s13, s14, s15, s16, s17, s18, s19;

    s0 = peg$currPos;
    s1 = [];
    s2 = peg$parseWS();
    while (s2 !== peg$FAILED) {
      s1.push(s2);
      s2 = peg$parseWS();
    }
    if (s1 !== peg$FAILED) {
      if (input.substr(peg$currPos, 6) === peg$c15) {
        s2 = peg$c15;
        peg$currPos += 6;
      } else {
        s2 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c16); }
      }
      if (s2 === peg$FAILED) {
        if (input.substr(peg$currPos, 6) === peg$c17) {
          s2 = peg$c17;
          peg$currPos += 6;
        } else {
          s2 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c18); }
        }
      }
      if (s2 !== peg$FAILED) {
        s3 = [];
        s4 = peg$parseWS();
        while (s4 !== peg$FAILED) {
          s3.push(s4);
          s4 = peg$parseWS();
        }
        if (s3 !== peg$FAILED) {
          if (input.substr(peg$currPos, 8) === peg$c19) {
            s4 = peg$c19;
            peg$currPos += 8;
          } else {
            s4 = peg$FAILED;
            if (peg$silentFails === 0) { peg$fail(peg$c20); }
          }
          if (s4 === peg$FAILED) {
            if (input.substr(peg$currPos, 8) === peg$c21) {
              s4 = peg$c21;
              peg$currPos += 8;
            } else {
              s4 = peg$FAILED;
              if (peg$silentFails === 0) { peg$fail(peg$c22); }
            }
          }
          if (s4 === peg$FAILED) {
            if (input.substr(peg$currPos, 7) === peg$c23) {
              s4 = peg$c23;
              peg$currPos += 7;
            } else {
              s4 = peg$FAILED;
              if (peg$silentFails === 0) { peg$fail(peg$c24); }
            }
            if (s4 === peg$FAILED) {
              if (input.substr(peg$currPos, 7) === peg$c25) {
                s4 = peg$c25;
                peg$currPos += 7;
              } else {
                s4 = peg$FAILED;
                if (peg$silentFails === 0) { peg$fail(peg$c26); }
              }
            }
          }
          if (s4 === peg$FAILED) {
            s4 = null;
          }
          if (s4 !== peg$FAILED) {
            s5 = [];
            s6 = peg$parseWS();
            while (s6 !== peg$FAILED) {
              s5.push(s6);
              s6 = peg$parseWS();
            }
            if (s5 !== peg$FAILED) {
              s6 = [];
              s7 = peg$currPos;
              s8 = [];
              s9 = peg$parseWS();
              while (s9 !== peg$FAILED) {
                s8.push(s9);
                s9 = peg$parseWS();
              }
              if (s8 !== peg$FAILED) {
                s9 = peg$parseVar();
                if (s9 !== peg$FAILED) {
                  s10 = [];
                  s11 = peg$parseWS();
                  while (s11 !== peg$FAILED) {
                    s10.push(s11);
                    s11 = peg$parseWS();
                  }
                  if (s10 !== peg$FAILED) {
                    s8 = [s8, s9, s10];
                    s7 = s8;
                  } else {
                    peg$currPos = s7;
                    s7 = peg$FAILED;
                  }
                } else {
                  peg$currPos = s7;
                  s7 = peg$FAILED;
                }
              } else {
                peg$currPos = s7;
                s7 = peg$FAILED;
              }
              if (s7 === peg$FAILED) {
                s7 = peg$currPos;
                s8 = [];
                s9 = peg$parseWS();
                while (s9 !== peg$FAILED) {
                  s8.push(s9);
                  s9 = peg$parseWS();
                }
                if (s8 !== peg$FAILED) {
                  if (input.charCodeAt(peg$currPos) === 40) {
                    s9 = peg$c27;
                    peg$currPos++;
                  } else {
                    s9 = peg$FAILED;
                    if (peg$silentFails === 0) { peg$fail(peg$c28); }
                  }
                  if (s9 !== peg$FAILED) {
                    s10 = [];
                    s11 = peg$parseWS();
                    while (s11 !== peg$FAILED) {
                      s10.push(s11);
                      s11 = peg$parseWS();
                    }
                    if (s10 !== peg$FAILED) {
                      s11 = peg$parseConditionalOrExpression();
                      if (s11 !== peg$FAILED) {
                        s12 = [];
                        s13 = peg$parseWS();
                        while (s13 !== peg$FAILED) {
                          s12.push(s13);
                          s13 = peg$parseWS();
                        }
                        if (s12 !== peg$FAILED) {
                          if (input.substr(peg$currPos, 2) === peg$c29) {
                            s13 = peg$c29;
                            peg$currPos += 2;
                          } else {
                            s13 = peg$FAILED;
                            if (peg$silentFails === 0) { peg$fail(peg$c30); }
                          }
                          if (s13 === peg$FAILED) {
                            if (input.substr(peg$currPos, 2) === peg$c31) {
                              s13 = peg$c31;
                              peg$currPos += 2;
                            } else {
                              s13 = peg$FAILED;
                              if (peg$silentFails === 0) { peg$fail(peg$c32); }
                            }
                          }
                          if (s13 !== peg$FAILED) {
                            s14 = [];
                            s15 = peg$parseWS();
                            while (s15 !== peg$FAILED) {
                              s14.push(s15);
                              s15 = peg$parseWS();
                            }
                            if (s14 !== peg$FAILED) {
                              s15 = peg$parseVar();
                              if (s15 !== peg$FAILED) {
                                s16 = [];
                                s17 = peg$parseWS();
                                while (s17 !== peg$FAILED) {
                                  s16.push(s17);
                                  s17 = peg$parseWS();
                                }
                                if (s16 !== peg$FAILED) {
                                  if (input.charCodeAt(peg$currPos) === 41) {
                                    s17 = peg$c33;
                                    peg$currPos++;
                                  } else {
                                    s17 = peg$FAILED;
                                    if (peg$silentFails === 0) { peg$fail(peg$c34); }
                                  }
                                  if (s17 !== peg$FAILED) {
                                    s18 = [];
                                    s19 = peg$parseWS();
                                    while (s19 !== peg$FAILED) {
                                      s18.push(s19);
                                      s19 = peg$parseWS();
                                    }
                                    if (s18 !== peg$FAILED) {
                                      s8 = [s8, s9, s10, s11, s12, s13, s14, s15, s16, s17, s18];
                                      s7 = s8;
                                    } else {
                                      peg$currPos = s7;
                                      s7 = peg$FAILED;
                                    }
                                  } else {
                                    peg$currPos = s7;
                                    s7 = peg$FAILED;
                                  }
                                } else {
                                  peg$currPos = s7;
                                  s7 = peg$FAILED;
                                }
                              } else {
                                peg$currPos = s7;
                                s7 = peg$FAILED;
                              }
                            } else {
                              peg$currPos = s7;
                              s7 = peg$FAILED;
                            }
                          } else {
                            peg$currPos = s7;
                            s7 = peg$FAILED;
                          }
                        } else {
                          peg$currPos = s7;
                          s7 = peg$FAILED;
                        }
                      } else {
                        peg$currPos = s7;
                        s7 = peg$FAILED;
                      }
                    } else {
                      peg$currPos = s7;
                      s7 = peg$FAILED;
                    }
                  } else {
                    peg$currPos = s7;
                    s7 = peg$FAILED;
                  }
                } else {
                  peg$currPos = s7;
                  s7 = peg$FAILED;
                }
              }
              if (s7 !== peg$FAILED) {
                while (s7 !== peg$FAILED) {
                  s6.push(s7);
                  s7 = peg$currPos;
                  s8 = [];
                  s9 = peg$parseWS();
                  while (s9 !== peg$FAILED) {
                    s8.push(s9);
                    s9 = peg$parseWS();
                  }
                  if (s8 !== peg$FAILED) {
                    s9 = peg$parseVar();
                    if (s9 !== peg$FAILED) {
                      s10 = [];
                      s11 = peg$parseWS();
                      while (s11 !== peg$FAILED) {
                        s10.push(s11);
                        s11 = peg$parseWS();
                      }
                      if (s10 !== peg$FAILED) {
                        s8 = [s8, s9, s10];
                        s7 = s8;
                      } else {
                        peg$currPos = s7;
                        s7 = peg$FAILED;
                      }
                    } else {
                      peg$currPos = s7;
                      s7 = peg$FAILED;
                    }
                  } else {
                    peg$currPos = s7;
                    s7 = peg$FAILED;
                  }
                  if (s7 === peg$FAILED) {
                    s7 = peg$currPos;
                    s8 = [];
                    s9 = peg$parseWS();
                    while (s9 !== peg$FAILED) {
                      s8.push(s9);
                      s9 = peg$parseWS();
                    }
                    if (s8 !== peg$FAILED) {
                      if (input.charCodeAt(peg$currPos) === 40) {
                        s9 = peg$c27;
                        peg$currPos++;
                      } else {
                        s9 = peg$FAILED;
                        if (peg$silentFails === 0) { peg$fail(peg$c28); }
                      }
                      if (s9 !== peg$FAILED) {
                        s10 = [];
                        s11 = peg$parseWS();
                        while (s11 !== peg$FAILED) {
                          s10.push(s11);
                          s11 = peg$parseWS();
                        }
                        if (s10 !== peg$FAILED) {
                          s11 = peg$parseConditionalOrExpression();
                          if (s11 !== peg$FAILED) {
                            s12 = [];
                            s13 = peg$parseWS();
                            while (s13 !== peg$FAILED) {
                              s12.push(s13);
                              s13 = peg$parseWS();
                            }
                            if (s12 !== peg$FAILED) {
                              if (input.substr(peg$currPos, 2) === peg$c29) {
                                s13 = peg$c29;
                                peg$currPos += 2;
                              } else {
                                s13 = peg$FAILED;
                                if (peg$silentFails === 0) { peg$fail(peg$c30); }
                              }
                              if (s13 === peg$FAILED) {
                                if (input.substr(peg$currPos, 2) === peg$c31) {
                                  s13 = peg$c31;
                                  peg$currPos += 2;
                                } else {
                                  s13 = peg$FAILED;
                                  if (peg$silentFails === 0) { peg$fail(peg$c32); }
                                }
                              }
                              if (s13 !== peg$FAILED) {
                                s14 = [];
                                s15 = peg$parseWS();
                                while (s15 !== peg$FAILED) {
                                  s14.push(s15);
                                  s15 = peg$parseWS();
                                }
                                if (s14 !== peg$FAILED) {
                                  s15 = peg$parseVar();
                                  if (s15 !== peg$FAILED) {
                                    s16 = [];
                                    s17 = peg$parseWS();
                                    while (s17 !== peg$FAILED) {
                                      s16.push(s17);
                                      s17 = peg$parseWS();
                                    }
                                    if (s16 !== peg$FAILED) {
                                      if (input.charCodeAt(peg$currPos) === 41) {
                                        s17 = peg$c33;
                                        peg$currPos++;
                                      } else {
                                        s17 = peg$FAILED;
                                        if (peg$silentFails === 0) { peg$fail(peg$c34); }
                                      }
                                      if (s17 !== peg$FAILED) {
                                        s18 = [];
                                        s19 = peg$parseWS();
                                        while (s19 !== peg$FAILED) {
                                          s18.push(s19);
                                          s19 = peg$parseWS();
                                        }
                                        if (s18 !== peg$FAILED) {
                                          s8 = [s8, s9, s10, s11, s12, s13, s14, s15, s16, s17, s18];
                                          s7 = s8;
                                        } else {
                                          peg$currPos = s7;
                                          s7 = peg$FAILED;
                                        }
                                      } else {
                                        peg$currPos = s7;
                                        s7 = peg$FAILED;
                                      }
                                    } else {
                                      peg$currPos = s7;
                                      s7 = peg$FAILED;
                                    }
                                  } else {
                                    peg$currPos = s7;
                                    s7 = peg$FAILED;
                                  }
                                } else {
                                  peg$currPos = s7;
                                  s7 = peg$FAILED;
                                }
                              } else {
                                peg$currPos = s7;
                                s7 = peg$FAILED;
                              }
                            } else {
                              peg$currPos = s7;
                              s7 = peg$FAILED;
                            }
                          } else {
                            peg$currPos = s7;
                            s7 = peg$FAILED;
                          }
                        } else {
                          peg$currPos = s7;
                          s7 = peg$FAILED;
                        }
                      } else {
                        peg$currPos = s7;
                        s7 = peg$FAILED;
                      }
                    } else {
                      peg$currPos = s7;
                      s7 = peg$FAILED;
                    }
                  }
                }
              } else {
                s6 = peg$FAILED;
              }
              if (s6 === peg$FAILED) {
                s6 = peg$currPos;
                s7 = [];
                s8 = peg$parseWS();
                while (s8 !== peg$FAILED) {
                  s7.push(s8);
                  s8 = peg$parseWS();
                }
                if (s7 !== peg$FAILED) {
                  if (input.charCodeAt(peg$currPos) === 42) {
                    s8 = peg$c35;
                    peg$currPos++;
                  } else {
                    s8 = peg$FAILED;
                    if (peg$silentFails === 0) { peg$fail(peg$c36); }
                  }
                  if (s8 !== peg$FAILED) {
                    s9 = [];
                    s10 = peg$parseWS();
                    while (s10 !== peg$FAILED) {
                      s9.push(s10);
                      s10 = peg$parseWS();
                    }
                    if (s9 !== peg$FAILED) {
                      s7 = [s7, s8, s9];
                      s6 = s7;
                    } else {
                      peg$currPos = s6;
                      s6 = peg$FAILED;
                    }
                  } else {
                    peg$currPos = s6;
                    s6 = peg$FAILED;
                  }
                } else {
                  peg$currPos = s6;
                  s6 = peg$FAILED;
                }
              }
              if (s6 !== peg$FAILED) {
                peg$savedPos = s0;
                s1 = peg$c37(s4, s6);
                s0 = s1;
              } else {
                peg$currPos = s0;
                s0 = peg$FAILED;
              }
            } else {
              peg$currPos = s0;
              s0 = peg$FAILED;
            }
          } else {
            peg$currPos = s0;
            s0 = peg$FAILED;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }

    return s0;
  }

  function peg$parseConstructQuery() {
    var s0, s1, s2, s3, s4, s5, s6, s7, s8, s9, s10, s11, s12, s13, s14;

    s0 = peg$currPos;
    s1 = [];
    s2 = peg$parseWS();
    while (s2 !== peg$FAILED) {
      s1.push(s2);
      s2 = peg$parseWS();
    }
    if (s1 !== peg$FAILED) {
      if (input.substr(peg$currPos, 9) === peg$c38) {
        s2 = peg$c38;
        peg$currPos += 9;
      } else {
        s2 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c39); }
      }
      if (s2 === peg$FAILED) {
        if (input.substr(peg$currPos, 9) === peg$c40) {
          s2 = peg$c40;
          peg$currPos += 9;
        } else {
          s2 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c41); }
        }
      }
      if (s2 !== peg$FAILED) {
        s3 = [];
        s4 = peg$parseWS();
        while (s4 !== peg$FAILED) {
          s3.push(s4);
          s4 = peg$parseWS();
        }
        if (s3 !== peg$FAILED) {
          s4 = peg$parseConstructTemplate();
          if (s4 !== peg$FAILED) {
            s5 = [];
            s6 = peg$parseWS();
            while (s6 !== peg$FAILED) {
              s5.push(s6);
              s6 = peg$parseWS();
            }
            if (s5 !== peg$FAILED) {
              s6 = [];
              s7 = peg$parseDatasetClause();
              while (s7 !== peg$FAILED) {
                s6.push(s7);
                s7 = peg$parseDatasetClause();
              }
              if (s6 !== peg$FAILED) {
                s7 = [];
                s8 = peg$parseWS();
                while (s8 !== peg$FAILED) {
                  s7.push(s8);
                  s8 = peg$parseWS();
                }
                if (s7 !== peg$FAILED) {
                  s8 = peg$parseWhereClause();
                  if (s8 !== peg$FAILED) {
                    s9 = [];
                    s10 = peg$parseWS();
                    while (s10 !== peg$FAILED) {
                      s9.push(s10);
                      s10 = peg$parseWS();
                    }
                    if (s9 !== peg$FAILED) {
                      s10 = peg$parseSolutionModifier();
                      if (s10 !== peg$FAILED) {
                        peg$savedPos = s0;
                        s1 = peg$c42(s4, s6, s8, s10);
                        s0 = s1;
                      } else {
                        peg$currPos = s0;
                        s0 = peg$FAILED;
                      }
                    } else {
                      peg$currPos = s0;
                      s0 = peg$FAILED;
                    }
                  } else {
                    peg$currPos = s0;
                    s0 = peg$FAILED;
                  }
                } else {
                  peg$currPos = s0;
                  s0 = peg$FAILED;
                }
              } else {
                peg$currPos = s0;
                s0 = peg$FAILED;
              }
            } else {
              peg$currPos = s0;
              s0 = peg$FAILED;
            }
          } else {
            peg$currPos = s0;
            s0 = peg$FAILED;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }
    if (s0 === peg$FAILED) {
      s0 = peg$currPos;
      s1 = [];
      s2 = peg$parseWS();
      while (s2 !== peg$FAILED) {
        s1.push(s2);
        s2 = peg$parseWS();
      }
      if (s1 !== peg$FAILED) {
        if (input.substr(peg$currPos, 9) === peg$c38) {
          s2 = peg$c38;
          peg$currPos += 9;
        } else {
          s2 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c39); }
        }
        if (s2 === peg$FAILED) {
          if (input.substr(peg$currPos, 9) === peg$c40) {
            s2 = peg$c40;
            peg$currPos += 9;
          } else {
            s2 = peg$FAILED;
            if (peg$silentFails === 0) { peg$fail(peg$c41); }
          }
        }
        if (s2 !== peg$FAILED) {
          s3 = [];
          s4 = peg$parseWS();
          while (s4 !== peg$FAILED) {
            s3.push(s4);
            s4 = peg$parseWS();
          }
          if (s3 !== peg$FAILED) {
            s4 = [];
            s5 = peg$parseDatasetClause();
            while (s5 !== peg$FAILED) {
              s4.push(s5);
              s5 = peg$parseDatasetClause();
            }
            if (s4 !== peg$FAILED) {
              s5 = [];
              s6 = peg$parseWS();
              while (s6 !== peg$FAILED) {
                s5.push(s6);
                s6 = peg$parseWS();
              }
              if (s5 !== peg$FAILED) {
                if (input.substr(peg$currPos, 5) === peg$c43) {
                  s6 = peg$c43;
                  peg$currPos += 5;
                } else {
                  s6 = peg$FAILED;
                  if (peg$silentFails === 0) { peg$fail(peg$c44); }
                }
                if (s6 === peg$FAILED) {
                  if (input.substr(peg$currPos, 5) === peg$c45) {
                    s6 = peg$c45;
                    peg$currPos += 5;
                  } else {
                    s6 = peg$FAILED;
                    if (peg$silentFails === 0) { peg$fail(peg$c46); }
                  }
                }
                if (s6 !== peg$FAILED) {
                  s7 = [];
                  s8 = peg$parseWS();
                  while (s8 !== peg$FAILED) {
                    s7.push(s8);
                    s8 = peg$parseWS();
                  }
                  if (s7 !== peg$FAILED) {
                    if (input.charCodeAt(peg$currPos) === 123) {
                      s8 = peg$c47;
                      peg$currPos++;
                    } else {
                      s8 = peg$FAILED;
                      if (peg$silentFails === 0) { peg$fail(peg$c48); }
                    }
                    if (s8 !== peg$FAILED) {
                      s9 = [];
                      s10 = peg$parseWS();
                      while (s10 !== peg$FAILED) {
                        s9.push(s10);
                        s10 = peg$parseWS();
                      }
                      if (s9 !== peg$FAILED) {
                        s10 = peg$parseTriplesTemplate();
                        if (s10 === peg$FAILED) {
                          s10 = null;
                        }
                        if (s10 !== peg$FAILED) {
                          s11 = [];
                          s12 = peg$parseWS();
                          while (s12 !== peg$FAILED) {
                            s11.push(s12);
                            s12 = peg$parseWS();
                          }
                          if (s11 !== peg$FAILED) {
                            if (input.charCodeAt(peg$currPos) === 125) {
                              s12 = peg$c49;
                              peg$currPos++;
                            } else {
                              s12 = peg$FAILED;
                              if (peg$silentFails === 0) { peg$fail(peg$c50); }
                            }
                            if (s12 !== peg$FAILED) {
                              s13 = [];
                              s14 = peg$parseWS();
                              while (s14 !== peg$FAILED) {
                                s13.push(s14);
                                s14 = peg$parseWS();
                              }
                              if (s13 !== peg$FAILED) {
                                s14 = peg$parseSolutionModifier();
                                if (s14 !== peg$FAILED) {
                                  peg$savedPos = s0;
                                  s1 = peg$c51(s4, s10, s14);
                                  s0 = s1;
                                } else {
                                  peg$currPos = s0;
                                  s0 = peg$FAILED;
                                }
                              } else {
                                peg$currPos = s0;
                                s0 = peg$FAILED;
                              }
                            } else {
                              peg$currPos = s0;
                              s0 = peg$FAILED;
                            }
                          } else {
                            peg$currPos = s0;
                            s0 = peg$FAILED;
                          }
                        } else {
                          peg$currPos = s0;
                          s0 = peg$FAILED;
                        }
                      } else {
                        peg$currPos = s0;
                        s0 = peg$FAILED;
                      }
                    } else {
                      peg$currPos = s0;
                      s0 = peg$FAILED;
                    }
                  } else {
                    peg$currPos = s0;
                    s0 = peg$FAILED;
                  }
                } else {
                  peg$currPos = s0;
                  s0 = peg$FAILED;
                }
              } else {
                peg$currPos = s0;
                s0 = peg$FAILED;
              }
            } else {
              peg$currPos = s0;
              s0 = peg$FAILED;
            }
          } else {
            peg$currPos = s0;
            s0 = peg$FAILED;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    }

    return s0;
  }

  function peg$parseDescribeQuery() {
    var s0, s1, s2, s3, s4, s5;

    s0 = peg$currPos;
    if (input.substr(peg$currPos, 8) === peg$c52) {
      s1 = peg$c52;
      peg$currPos += 8;
    } else {
      s1 = peg$FAILED;
      if (peg$silentFails === 0) { peg$fail(peg$c53); }
    }
    if (s1 !== peg$FAILED) {
      s2 = [];
      s3 = peg$parseVarOrIRIref();
      if (s3 !== peg$FAILED) {
        while (s3 !== peg$FAILED) {
          s2.push(s3);
          s3 = peg$parseVarOrIRIref();
        }
      } else {
        s2 = peg$FAILED;
      }
      if (s2 === peg$FAILED) {
        if (input.charCodeAt(peg$currPos) === 42) {
          s2 = peg$c35;
          peg$currPos++;
        } else {
          s2 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c36); }
        }
      }
      if (s2 !== peg$FAILED) {
        s3 = [];
        s4 = peg$parseDatasetClause();
        while (s4 !== peg$FAILED) {
          s3.push(s4);
          s4 = peg$parseDatasetClause();
        }
        if (s3 !== peg$FAILED) {
          s4 = peg$parseWhereClause();
          if (s4 === peg$FAILED) {
            s4 = null;
          }
          if (s4 !== peg$FAILED) {
            s5 = peg$parseSolutionModifier();
            if (s5 !== peg$FAILED) {
              s1 = [s1, s2, s3, s4, s5];
              s0 = s1;
            } else {
              peg$currPos = s0;
              s0 = peg$FAILED;
            }
          } else {
            peg$currPos = s0;
            s0 = peg$FAILED;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }

    return s0;
  }

  function peg$parseAskQuery() {
    var s0, s1, s2, s3, s4, s5, s6;

    s0 = peg$currPos;
    s1 = [];
    s2 = peg$parseWS();
    while (s2 !== peg$FAILED) {
      s1.push(s2);
      s2 = peg$parseWS();
    }
    if (s1 !== peg$FAILED) {
      if (input.substr(peg$currPos, 3) === peg$c54) {
        s2 = peg$c54;
        peg$currPos += 3;
      } else {
        s2 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c55); }
      }
      if (s2 === peg$FAILED) {
        if (input.substr(peg$currPos, 3) === peg$c56) {
          s2 = peg$c56;
          peg$currPos += 3;
        } else {
          s2 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c57); }
        }
      }
      if (s2 !== peg$FAILED) {
        s3 = [];
        s4 = peg$parseWS();
        while (s4 !== peg$FAILED) {
          s3.push(s4);
          s4 = peg$parseWS();
        }
        if (s3 !== peg$FAILED) {
          s4 = [];
          s5 = peg$parseDatasetClause();
          while (s5 !== peg$FAILED) {
            s4.push(s5);
            s5 = peg$parseDatasetClause();
          }
          if (s4 !== peg$FAILED) {
            s5 = [];
            s6 = peg$parseWS();
            while (s6 !== peg$FAILED) {
              s5.push(s6);
              s6 = peg$parseWS();
            }
            if (s5 !== peg$FAILED) {
              s6 = peg$parseWhereClause();
              if (s6 !== peg$FAILED) {
                peg$savedPos = s0;
                s1 = peg$c58(s4, s6);
                s0 = s1;
              } else {
                peg$currPos = s0;
                s0 = peg$FAILED;
              }
            } else {
              peg$currPos = s0;
              s0 = peg$FAILED;
            }
          } else {
            peg$currPos = s0;
            s0 = peg$FAILED;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }

    return s0;
  }

  function peg$parseDatasetClause() {
    var s0, s1, s2, s3, s4, s5;

    s0 = peg$currPos;
    if (input.substr(peg$currPos, 4) === peg$c59) {
      s1 = peg$c59;
      peg$currPos += 4;
    } else {
      s1 = peg$FAILED;
      if (peg$silentFails === 0) { peg$fail(peg$c60); }
    }
    if (s1 === peg$FAILED) {
      if (input.substr(peg$currPos, 4) === peg$c61) {
        s1 = peg$c61;
        peg$currPos += 4;
      } else {
        s1 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c62); }
      }
    }
    if (s1 !== peg$FAILED) {
      s2 = [];
      s3 = peg$parseWS();
      while (s3 !== peg$FAILED) {
        s2.push(s3);
        s3 = peg$parseWS();
      }
      if (s2 !== peg$FAILED) {
        s3 = peg$parseDefaultGraphClause();
        if (s3 === peg$FAILED) {
          s3 = peg$parseNamedGraphClause();
        }
        if (s3 !== peg$FAILED) {
          s4 = [];
          s5 = peg$parseWS();
          while (s5 !== peg$FAILED) {
            s4.push(s5);
            s5 = peg$parseWS();
          }
          if (s4 !== peg$FAILED) {
            peg$savedPos = s0;
            s1 = peg$c63(s3);
            s0 = s1;
          } else {
            peg$currPos = s0;
            s0 = peg$FAILED;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }

    return s0;
  }

  function peg$parseDefaultGraphClause() {
    var s0, s1, s2;

    s0 = peg$currPos;
    s1 = [];
    s2 = peg$parseWS();
    while (s2 !== peg$FAILED) {
      s1.push(s2);
      s2 = peg$parseWS();
    }
    if (s1 !== peg$FAILED) {
      s2 = peg$parseIRIref();
      if (s2 !== peg$FAILED) {
        peg$savedPos = s0;
        s1 = peg$c64(s2);
        s0 = s1;
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }

    return s0;
  }

  function peg$parseNamedGraphClause() {
    var s0, s1, s2, s3;

    s0 = peg$currPos;
    if (input.substr(peg$currPos, 5) === peg$c65) {
      s1 = peg$c65;
      peg$currPos += 5;
    } else {
      s1 = peg$FAILED;
      if (peg$silentFails === 0) { peg$fail(peg$c66); }
    }
    if (s1 === peg$FAILED) {
      if (input.substr(peg$currPos, 5) === peg$c67) {
        s1 = peg$c67;
        peg$currPos += 5;
      } else {
        s1 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c68); }
      }
    }
    if (s1 !== peg$FAILED) {
      s2 = [];
      s3 = peg$parseWS();
      while (s3 !== peg$FAILED) {
        s2.push(s3);
        s3 = peg$parseWS();
      }
      if (s2 !== peg$FAILED) {
        s3 = peg$parseIRIref();
        if (s3 !== peg$FAILED) {
          peg$savedPos = s0;
          s1 = peg$c69(s3);
          s0 = s1;
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }

    return s0;
  }

  function peg$parseWhereClause() {
    var s0, s1, s2, s3, s4, s5;

    s0 = peg$currPos;
    if (input.substr(peg$currPos, 5) === peg$c43) {
      s1 = peg$c43;
      peg$currPos += 5;
    } else {
      s1 = peg$FAILED;
      if (peg$silentFails === 0) { peg$fail(peg$c44); }
    }
    if (s1 === peg$FAILED) {
      if (input.substr(peg$currPos, 5) === peg$c45) {
        s1 = peg$c45;
        peg$currPos += 5;
      } else {
        s1 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c46); }
      }
    }
    if (s1 === peg$FAILED) {
      s1 = null;
    }
    if (s1 !== peg$FAILED) {
      s2 = [];
      s3 = peg$parseWS();
      while (s3 !== peg$FAILED) {
        s2.push(s3);
        s3 = peg$parseWS();
      }
      if (s2 !== peg$FAILED) {
        s3 = peg$parseGroupGraphPattern();
        if (s3 !== peg$FAILED) {
          s4 = [];
          s5 = peg$parseWS();
          while (s5 !== peg$FAILED) {
            s4.push(s5);
            s5 = peg$parseWS();
          }
          if (s4 !== peg$FAILED) {
            peg$savedPos = s0;
            s1 = peg$c70(s3);
            s0 = s1;
          } else {
            peg$currPos = s0;
            s0 = peg$FAILED;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }

    return s0;
  }

  function peg$parseSolutionModifier() {
    var s0, s1, s2, s3, s4;

    s0 = peg$currPos;
    s1 = peg$parseGroupClause();
    if (s1 === peg$FAILED) {
      s1 = null;
    }
    if (s1 !== peg$FAILED) {
      s2 = peg$parseHavingClause();
      if (s2 === peg$FAILED) {
        s2 = null;
      }
      if (s2 !== peg$FAILED) {
        s3 = peg$parseOrderClause();
        if (s3 === peg$FAILED) {
          s3 = null;
        }
        if (s3 !== peg$FAILED) {
          s4 = peg$parseLimitOffsetClauses();
          if (s4 === peg$FAILED) {
            s4 = null;
          }
          if (s4 !== peg$FAILED) {
            peg$savedPos = s0;
            s1 = peg$c71(s1, s3, s4);
            s0 = s1;
          } else {
            peg$currPos = s0;
            s0 = peg$FAILED;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }

    return s0;
  }

  function peg$parseGroupClause() {
    var s0, s1, s2, s3, s4, s5, s6;

    s0 = peg$currPos;
    if (input.substr(peg$currPos, 5) === peg$c72) {
      s1 = peg$c72;
      peg$currPos += 5;
    } else {
      s1 = peg$FAILED;
      if (peg$silentFails === 0) { peg$fail(peg$c73); }
    }
    if (s1 === peg$FAILED) {
      if (input.substr(peg$currPos, 5) === peg$c74) {
        s1 = peg$c74;
        peg$currPos += 5;
      } else {
        s1 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c75); }
      }
    }
    if (s1 !== peg$FAILED) {
      s2 = [];
      s3 = peg$parseWS();
      while (s3 !== peg$FAILED) {
        s2.push(s3);
        s3 = peg$parseWS();
      }
      if (s2 !== peg$FAILED) {
        if (input.substr(peg$currPos, 2) === peg$c76) {
          s3 = peg$c76;
          peg$currPos += 2;
        } else {
          s3 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c77); }
        }
        if (s3 === peg$FAILED) {
          if (input.substr(peg$currPos, 2) === peg$c78) {
            s3 = peg$c78;
            peg$currPos += 2;
          } else {
            s3 = peg$FAILED;
            if (peg$silentFails === 0) { peg$fail(peg$c79); }
          }
        }
        if (s3 !== peg$FAILED) {
          s4 = [];
          s5 = peg$parseWS();
          while (s5 !== peg$FAILED) {
            s4.push(s5);
            s5 = peg$parseWS();
          }
          if (s4 !== peg$FAILED) {
            s5 = [];
            s6 = peg$parseGroupCondition();
            if (s6 !== peg$FAILED) {
              while (s6 !== peg$FAILED) {
                s5.push(s6);
                s6 = peg$parseGroupCondition();
              }
            } else {
              s5 = peg$FAILED;
            }
            if (s5 !== peg$FAILED) {
              peg$savedPos = s0;
              s1 = peg$c80(s5);
              s0 = s1;
            } else {
              peg$currPos = s0;
              s0 = peg$FAILED;
            }
          } else {
            peg$currPos = s0;
            s0 = peg$FAILED;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }

    return s0;
  }

  function peg$parseGroupCondition() {
    var s0, s1, s2, s3, s4, s5, s6, s7, s8, s9, s10;

    s0 = peg$currPos;
    s1 = [];
    s2 = peg$parseWS();
    while (s2 !== peg$FAILED) {
      s1.push(s2);
      s2 = peg$parseWS();
    }
    if (s1 !== peg$FAILED) {
      s2 = peg$parseBuiltInCall();
      if (s2 !== peg$FAILED) {
        s3 = [];
        s4 = peg$parseWS();
        while (s4 !== peg$FAILED) {
          s3.push(s4);
          s4 = peg$parseWS();
        }
        if (s3 !== peg$FAILED) {
          peg$savedPos = s0;
          s1 = peg$c81(s2);
          s0 = s1;
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }
    if (s0 === peg$FAILED) {
      s0 = peg$currPos;
      s1 = [];
      s2 = peg$parseWS();
      while (s2 !== peg$FAILED) {
        s1.push(s2);
        s2 = peg$parseWS();
      }
      if (s1 !== peg$FAILED) {
        s2 = peg$parseFunctionCall();
        if (s2 !== peg$FAILED) {
          s3 = [];
          s4 = peg$parseWS();
          while (s4 !== peg$FAILED) {
            s3.push(s4);
            s4 = peg$parseWS();
          }
          if (s3 !== peg$FAILED) {
            peg$savedPos = s0;
            s1 = peg$c82(s2);
            s0 = s1;
          } else {
            peg$currPos = s0;
            s0 = peg$FAILED;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
      if (s0 === peg$FAILED) {
        s0 = peg$currPos;
        s1 = [];
        s2 = peg$parseWS();
        while (s2 !== peg$FAILED) {
          s1.push(s2);
          s2 = peg$parseWS();
        }
        if (s1 !== peg$FAILED) {
          if (input.charCodeAt(peg$currPos) === 40) {
            s2 = peg$c27;
            peg$currPos++;
          } else {
            s2 = peg$FAILED;
            if (peg$silentFails === 0) { peg$fail(peg$c28); }
          }
          if (s2 !== peg$FAILED) {
            s3 = [];
            s4 = peg$parseWS();
            while (s4 !== peg$FAILED) {
              s3.push(s4);
              s4 = peg$parseWS();
            }
            if (s3 !== peg$FAILED) {
              s4 = peg$parseConditionalOrExpression();
              if (s4 !== peg$FAILED) {
                s5 = [];
                s6 = peg$parseWS();
                while (s6 !== peg$FAILED) {
                  s5.push(s6);
                  s6 = peg$parseWS();
                }
                if (s5 !== peg$FAILED) {
                  s6 = peg$currPos;
                  if (input.substr(peg$currPos, 2) === peg$c29) {
                    s7 = peg$c29;
                    peg$currPos += 2;
                  } else {
                    s7 = peg$FAILED;
                    if (peg$silentFails === 0) { peg$fail(peg$c30); }
                  }
                  if (s7 === peg$FAILED) {
                    if (input.substr(peg$currPos, 2) === peg$c31) {
                      s7 = peg$c31;
                      peg$currPos += 2;
                    } else {
                      s7 = peg$FAILED;
                      if (peg$silentFails === 0) { peg$fail(peg$c32); }
                    }
                  }
                  if (s7 !== peg$FAILED) {
                    s8 = [];
                    s9 = peg$parseWS();
                    while (s9 !== peg$FAILED) {
                      s8.push(s9);
                      s9 = peg$parseWS();
                    }
                    if (s8 !== peg$FAILED) {
                      s9 = peg$parseVar();
                      if (s9 !== peg$FAILED) {
                        s7 = [s7, s8, s9];
                        s6 = s7;
                      } else {
                        peg$currPos = s6;
                        s6 = peg$FAILED;
                      }
                    } else {
                      peg$currPos = s6;
                      s6 = peg$FAILED;
                    }
                  } else {
                    peg$currPos = s6;
                    s6 = peg$FAILED;
                  }
                  if (s6 === peg$FAILED) {
                    s6 = null;
                  }
                  if (s6 !== peg$FAILED) {
                    s7 = [];
                    s8 = peg$parseWS();
                    while (s8 !== peg$FAILED) {
                      s7.push(s8);
                      s8 = peg$parseWS();
                    }
                    if (s7 !== peg$FAILED) {
                      if (input.charCodeAt(peg$currPos) === 41) {
                        s8 = peg$c33;
                        peg$currPos++;
                      } else {
                        s8 = peg$FAILED;
                        if (peg$silentFails === 0) { peg$fail(peg$c34); }
                      }
                      if (s8 !== peg$FAILED) {
                        s9 = [];
                        s10 = peg$parseWS();
                        while (s10 !== peg$FAILED) {
                          s9.push(s10);
                          s10 = peg$parseWS();
                        }
                        if (s9 !== peg$FAILED) {
                          peg$savedPos = s0;
                          s1 = peg$c83(s4, s6);
                          s0 = s1;
                        } else {
                          peg$currPos = s0;
                          s0 = peg$FAILED;
                        }
                      } else {
                        peg$currPos = s0;
                        s0 = peg$FAILED;
                      }
                    } else {
                      peg$currPos = s0;
                      s0 = peg$FAILED;
                    }
                  } else {
                    peg$currPos = s0;
                    s0 = peg$FAILED;
                  }
                } else {
                  peg$currPos = s0;
                  s0 = peg$FAILED;
                }
              } else {
                peg$currPos = s0;
                s0 = peg$FAILED;
              }
            } else {
              peg$currPos = s0;
              s0 = peg$FAILED;
            }
          } else {
            peg$currPos = s0;
            s0 = peg$FAILED;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
        if (s0 === peg$FAILED) {
          s0 = peg$currPos;
          s1 = [];
          s2 = peg$parseWS();
          while (s2 !== peg$FAILED) {
            s1.push(s2);
            s2 = peg$parseWS();
          }
          if (s1 !== peg$FAILED) {
            s2 = peg$parseVar();
            if (s2 !== peg$FAILED) {
              s3 = [];
              s4 = peg$parseWS();
              while (s4 !== peg$FAILED) {
                s3.push(s4);
                s4 = peg$parseWS();
              }
              if (s3 !== peg$FAILED) {
                peg$savedPos = s0;
                s1 = peg$c84(s2);
                s0 = s1;
              } else {
                peg$currPos = s0;
                s0 = peg$FAILED;
              }
            } else {
              peg$currPos = s0;
              s0 = peg$FAILED;
            }
          } else {
            peg$currPos = s0;
            s0 = peg$FAILED;
          }
        }
      }
    }

    return s0;
  }

  function peg$parseHavingClause() {
    var s0, s1, s2, s3;

    s0 = peg$currPos;
    if (input.substr(peg$currPos, 6) === peg$c85) {
      s1 = peg$c85;
      peg$currPos += 6;
    } else {
      s1 = peg$FAILED;
      if (peg$silentFails === 0) { peg$fail(peg$c86); }
    }
    if (s1 !== peg$FAILED) {
      s2 = [];
      s3 = peg$parseConstraint();
      if (s3 !== peg$FAILED) {
        while (s3 !== peg$FAILED) {
          s2.push(s3);
          s3 = peg$parseConstraint();
        }
      } else {
        s2 = peg$FAILED;
      }
      if (s2 !== peg$FAILED) {
        s1 = [s1, s2];
        s0 = s1;
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }

    return s0;
  }

  function peg$parseOrderClause() {
    var s0, s1, s2, s3, s4, s5, s6, s7;

    s0 = peg$currPos;
    if (input.substr(peg$currPos, 5) === peg$c87) {
      s1 = peg$c87;
      peg$currPos += 5;
    } else {
      s1 = peg$FAILED;
      if (peg$silentFails === 0) { peg$fail(peg$c88); }
    }
    if (s1 === peg$FAILED) {
      if (input.substr(peg$currPos, 5) === peg$c89) {
        s1 = peg$c89;
        peg$currPos += 5;
      } else {
        s1 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c90); }
      }
    }
    if (s1 !== peg$FAILED) {
      s2 = [];
      s3 = peg$parseWS();
      while (s3 !== peg$FAILED) {
        s2.push(s3);
        s3 = peg$parseWS();
      }
      if (s2 !== peg$FAILED) {
        if (input.substr(peg$currPos, 2) === peg$c76) {
          s3 = peg$c76;
          peg$currPos += 2;
        } else {
          s3 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c77); }
        }
        if (s3 === peg$FAILED) {
          if (input.substr(peg$currPos, 2) === peg$c78) {
            s3 = peg$c78;
            peg$currPos += 2;
          } else {
            s3 = peg$FAILED;
            if (peg$silentFails === 0) { peg$fail(peg$c79); }
          }
        }
        if (s3 !== peg$FAILED) {
          s4 = [];
          s5 = peg$parseWS();
          while (s5 !== peg$FAILED) {
            s4.push(s5);
            s5 = peg$parseWS();
          }
          if (s4 !== peg$FAILED) {
            s5 = [];
            s6 = peg$parseOrderCondition();
            if (s6 !== peg$FAILED) {
              while (s6 !== peg$FAILED) {
                s5.push(s6);
                s6 = peg$parseOrderCondition();
              }
            } else {
              s5 = peg$FAILED;
            }
            if (s5 !== peg$FAILED) {
              s6 = [];
              s7 = peg$parseWS();
              while (s7 !== peg$FAILED) {
                s6.push(s7);
                s7 = peg$parseWS();
              }
              if (s6 !== peg$FAILED) {
                peg$savedPos = s0;
                s1 = peg$c91(s5);
                s0 = s1;
              } else {
                peg$currPos = s0;
                s0 = peg$FAILED;
              }
            } else {
              peg$currPos = s0;
              s0 = peg$FAILED;
            }
          } else {
            peg$currPos = s0;
            s0 = peg$FAILED;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }

    return s0;
  }

  function peg$parseOrderCondition() {
    var s0, s1, s2, s3, s4, s5;

    s0 = peg$currPos;
    if (input.substr(peg$currPos, 3) === peg$c92) {
      s1 = peg$c92;
      peg$currPos += 3;
    } else {
      s1 = peg$FAILED;
      if (peg$silentFails === 0) { peg$fail(peg$c93); }
    }
    if (s1 === peg$FAILED) {
      if (input.substr(peg$currPos, 3) === peg$c94) {
        s1 = peg$c94;
        peg$currPos += 3;
      } else {
        s1 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c95); }
      }
      if (s1 === peg$FAILED) {
        if (input.substr(peg$currPos, 4) === peg$c96) {
          s1 = peg$c96;
          peg$currPos += 4;
        } else {
          s1 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c97); }
        }
        if (s1 === peg$FAILED) {
          if (input.substr(peg$currPos, 4) === peg$c98) {
            s1 = peg$c98;
            peg$currPos += 4;
          } else {
            s1 = peg$FAILED;
            if (peg$silentFails === 0) { peg$fail(peg$c99); }
          }
        }
      }
    }
    if (s1 !== peg$FAILED) {
      s2 = [];
      s3 = peg$parseWS();
      while (s3 !== peg$FAILED) {
        s2.push(s3);
        s3 = peg$parseWS();
      }
      if (s2 !== peg$FAILED) {
        s3 = peg$parseBrackettedExpression();
        if (s3 !== peg$FAILED) {
          s4 = [];
          s5 = peg$parseWS();
          while (s5 !== peg$FAILED) {
            s4.push(s5);
            s5 = peg$parseWS();
          }
          if (s4 !== peg$FAILED) {
            peg$savedPos = s0;
            s1 = peg$c100(s1, s3);
            s0 = s1;
          } else {
            peg$currPos = s0;
            s0 = peg$FAILED;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }
    if (s0 === peg$FAILED) {
      s0 = peg$currPos;
      s1 = peg$parseConstraint();
      if (s1 === peg$FAILED) {
        s1 = peg$parseVar();
      }
      if (s1 !== peg$FAILED) {
        s2 = [];
        s3 = peg$parseWS();
        while (s3 !== peg$FAILED) {
          s2.push(s3);
          s3 = peg$parseWS();
        }
        if (s2 !== peg$FAILED) {
          peg$savedPos = s0;
          s1 = peg$c101(s1);
          s0 = s1;
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    }

    return s0;
  }

  function peg$parseLimitOffsetClauses() {
    var s0, s1, s2, s3;

    s0 = peg$currPos;
    s1 = peg$currPos;
    s2 = peg$parseLimitClause();
    if (s2 !== peg$FAILED) {
      s3 = peg$parseOffsetClause();
      if (s3 === peg$FAILED) {
        s3 = null;
      }
      if (s3 !== peg$FAILED) {
        s2 = [s2, s3];
        s1 = s2;
      } else {
        peg$currPos = s1;
        s1 = peg$FAILED;
      }
    } else {
      peg$currPos = s1;
      s1 = peg$FAILED;
    }
    if (s1 === peg$FAILED) {
      s1 = peg$currPos;
      s2 = peg$parseOffsetClause();
      if (s2 !== peg$FAILED) {
        s3 = peg$parseLimitClause();
        if (s3 === peg$FAILED) {
          s3 = null;
        }
        if (s3 !== peg$FAILED) {
          s2 = [s2, s3];
          s1 = s2;
        } else {
          peg$currPos = s1;
          s1 = peg$FAILED;
        }
      } else {
        peg$currPos = s1;
        s1 = peg$FAILED;
      }
    }
    if (s1 !== peg$FAILED) {
      peg$savedPos = s0;
      s1 = peg$c102(s1);
    }
    s0 = s1;

    return s0;
  }

  function peg$parseLimitClause() {
    var s0, s1, s2, s3, s4, s5;

    s0 = peg$currPos;
    if (input.substr(peg$currPos, 5) === peg$c103) {
      s1 = peg$c103;
      peg$currPos += 5;
    } else {
      s1 = peg$FAILED;
      if (peg$silentFails === 0) { peg$fail(peg$c104); }
    }
    if (s1 === peg$FAILED) {
      if (input.substr(peg$currPos, 5) === peg$c105) {
        s1 = peg$c105;
        peg$currPos += 5;
      } else {
        s1 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c106); }
      }
    }
    if (s1 !== peg$FAILED) {
      s2 = [];
      s3 = peg$parseWS();
      while (s3 !== peg$FAILED) {
        s2.push(s3);
        s3 = peg$parseWS();
      }
      if (s2 !== peg$FAILED) {
        s3 = peg$parseINTEGER();
        if (s3 !== peg$FAILED) {
          s4 = [];
          s5 = peg$parseWS();
          while (s5 !== peg$FAILED) {
            s4.push(s5);
            s5 = peg$parseWS();
          }
          if (s4 !== peg$FAILED) {
            peg$savedPos = s0;
            s1 = peg$c107(s3);
            s0 = s1;
          } else {
            peg$currPos = s0;
            s0 = peg$FAILED;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }

    return s0;
  }

  function peg$parseOffsetClause() {
    var s0, s1, s2, s3, s4, s5;

    s0 = peg$currPos;
    if (input.substr(peg$currPos, 6) === peg$c108) {
      s1 = peg$c108;
      peg$currPos += 6;
    } else {
      s1 = peg$FAILED;
      if (peg$silentFails === 0) { peg$fail(peg$c109); }
    }
    if (s1 === peg$FAILED) {
      if (input.substr(peg$currPos, 6) === peg$c110) {
        s1 = peg$c110;
        peg$currPos += 6;
      } else {
        s1 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c111); }
      }
    }
    if (s1 !== peg$FAILED) {
      s2 = [];
      s3 = peg$parseWS();
      while (s3 !== peg$FAILED) {
        s2.push(s3);
        s3 = peg$parseWS();
      }
      if (s2 !== peg$FAILED) {
        s3 = peg$parseINTEGER();
        if (s3 !== peg$FAILED) {
          s4 = [];
          s5 = peg$parseWS();
          while (s5 !== peg$FAILED) {
            s4.push(s5);
            s5 = peg$parseWS();
          }
          if (s4 !== peg$FAILED) {
            peg$savedPos = s0;
            s1 = peg$c112(s3);
            s0 = s1;
          } else {
            peg$currPos = s0;
            s0 = peg$FAILED;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }

    return s0;
  }

  function peg$parseBindingsClause() {
    var s0, s1, s2, s3, s4, s5, s6, s7, s8;

    s0 = peg$currPos;
    if (input.substr(peg$currPos, 8) === peg$c113) {
      s1 = peg$c113;
      peg$currPos += 8;
    } else {
      s1 = peg$FAILED;
      if (peg$silentFails === 0) { peg$fail(peg$c114); }
    }
    if (s1 !== peg$FAILED) {
      s2 = [];
      s3 = peg$parseVar();
      while (s3 !== peg$FAILED) {
        s2.push(s3);
        s3 = peg$parseVar();
      }
      if (s2 !== peg$FAILED) {
        if (input.charCodeAt(peg$currPos) === 123) {
          s3 = peg$c47;
          peg$currPos++;
        } else {
          s3 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c48); }
        }
        if (s3 !== peg$FAILED) {
          s4 = [];
          s5 = peg$currPos;
          if (input.charCodeAt(peg$currPos) === 40) {
            s6 = peg$c27;
            peg$currPos++;
          } else {
            s6 = peg$FAILED;
            if (peg$silentFails === 0) { peg$fail(peg$c28); }
          }
          if (s6 !== peg$FAILED) {
            s7 = [];
            s8 = peg$parseBindingValue();
            if (s8 !== peg$FAILED) {
              while (s8 !== peg$FAILED) {
                s7.push(s8);
                s8 = peg$parseBindingValue();
              }
            } else {
              s7 = peg$FAILED;
            }
            if (s7 !== peg$FAILED) {
              if (input.charCodeAt(peg$currPos) === 41) {
                s8 = peg$c33;
                peg$currPos++;
              } else {
                s8 = peg$FAILED;
                if (peg$silentFails === 0) { peg$fail(peg$c34); }
              }
              if (s8 !== peg$FAILED) {
                s6 = [s6, s7, s8];
                s5 = s6;
              } else {
                peg$currPos = s5;
                s5 = peg$FAILED;
              }
            } else {
              peg$currPos = s5;
              s5 = peg$FAILED;
            }
          } else {
            peg$currPos = s5;
            s5 = peg$FAILED;
          }
          if (s5 === peg$FAILED) {
            s5 = peg$parseNIL();
          }
          while (s5 !== peg$FAILED) {
            s4.push(s5);
            s5 = peg$currPos;
            if (input.charCodeAt(peg$currPos) === 40) {
              s6 = peg$c27;
              peg$currPos++;
            } else {
              s6 = peg$FAILED;
              if (peg$silentFails === 0) { peg$fail(peg$c28); }
            }
            if (s6 !== peg$FAILED) {
              s7 = [];
              s8 = peg$parseBindingValue();
              if (s8 !== peg$FAILED) {
                while (s8 !== peg$FAILED) {
                  s7.push(s8);
                  s8 = peg$parseBindingValue();
                }
              } else {
                s7 = peg$FAILED;
              }
              if (s7 !== peg$FAILED) {
                if (input.charCodeAt(peg$currPos) === 41) {
                  s8 = peg$c33;
                  peg$currPos++;
                } else {
                  s8 = peg$FAILED;
                  if (peg$silentFails === 0) { peg$fail(peg$c34); }
                }
                if (s8 !== peg$FAILED) {
                  s6 = [s6, s7, s8];
                  s5 = s6;
                } else {
                  peg$currPos = s5;
                  s5 = peg$FAILED;
                }
              } else {
                peg$currPos = s5;
                s5 = peg$FAILED;
              }
            } else {
              peg$currPos = s5;
              s5 = peg$FAILED;
            }
            if (s5 === peg$FAILED) {
              s5 = peg$parseNIL();
            }
          }
          if (s4 !== peg$FAILED) {
            if (input.charCodeAt(peg$currPos) === 125) {
              s5 = peg$c49;
              peg$currPos++;
            } else {
              s5 = peg$FAILED;
              if (peg$silentFails === 0) { peg$fail(peg$c50); }
            }
            if (s5 !== peg$FAILED) {
              s1 = [s1, s2, s3, s4, s5];
              s0 = s1;
            } else {
              peg$currPos = s0;
              s0 = peg$FAILED;
            }
          } else {
            peg$currPos = s0;
            s0 = peg$FAILED;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }
    if (s0 === peg$FAILED) {
      s0 = null;
    }

    return s0;
  }

  function peg$parseBindingValue() {
    var s0;

    s0 = peg$parseIRIref();
    if (s0 === peg$FAILED) {
      s0 = peg$parseRDFLiteral();
      if (s0 === peg$FAILED) {
        s0 = peg$parseNumericLiteral();
        if (s0 === peg$FAILED) {
          s0 = peg$parseBooleanLiteral();
          if (s0 === peg$FAILED) {
            if (input.substr(peg$currPos, 5) === peg$c115) {
              s0 = peg$c115;
              peg$currPos += 5;
            } else {
              s0 = peg$FAILED;
              if (peg$silentFails === 0) { peg$fail(peg$c116); }
            }
          }
        }
      }
    }

    return s0;
  }

  function peg$parseValuesClause() {
    var s0, s1, s2, s3;

    s0 = peg$currPos;
    s1 = peg$currPos;
    if (input.substr(peg$currPos, 6) === peg$c117) {
      s2 = peg$c117;
      peg$currPos += 6;
    } else {
      s2 = peg$FAILED;
      if (peg$silentFails === 0) { peg$fail(peg$c118); }
    }
    if (s2 === peg$FAILED) {
      if (input.substr(peg$currPos, 6) === peg$c119) {
        s2 = peg$c119;
        peg$currPos += 6;
      } else {
        s2 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c120); }
      }
    }
    if (s2 !== peg$FAILED) {
      s3 = peg$parseDataBlock();
      if (s3 !== peg$FAILED) {
        s2 = [s2, s3];
        s1 = s2;
      } else {
        peg$currPos = s1;
        s1 = peg$FAILED;
      }
    } else {
      peg$currPos = s1;
      s1 = peg$FAILED;
    }
    if (s1 === peg$FAILED) {
      s1 = null;
    }
    if (s1 !== peg$FAILED) {
      peg$savedPos = s0;
      s1 = peg$c121(s1);
    }
    s0 = s1;

    return s0;
  }

  function peg$parseUpdate() {
    var s0, s1, s2, s3, s4, s5, s6, s7, s8;

    s0 = peg$currPos;
    s1 = peg$parsePrologue();
    if (s1 !== peg$FAILED) {
      s2 = [];
      s3 = peg$parseWS();
      while (s3 !== peg$FAILED) {
        s2.push(s3);
        s3 = peg$parseWS();
      }
      if (s2 !== peg$FAILED) {
        s3 = peg$parseUpdate1();
        if (s3 !== peg$FAILED) {
          s4 = peg$currPos;
          s5 = [];
          s6 = peg$parseWS();
          while (s6 !== peg$FAILED) {
            s5.push(s6);
            s6 = peg$parseWS();
          }
          if (s5 !== peg$FAILED) {
            if (input.charCodeAt(peg$currPos) === 59) {
              s6 = peg$c122;
              peg$currPos++;
            } else {
              s6 = peg$FAILED;
              if (peg$silentFails === 0) { peg$fail(peg$c123); }
            }
            if (s6 !== peg$FAILED) {
              s7 = [];
              s8 = peg$parseWS();
              while (s8 !== peg$FAILED) {
                s7.push(s8);
                s8 = peg$parseWS();
              }
              if (s7 !== peg$FAILED) {
                s8 = peg$parseUpdate();
                if (s8 === peg$FAILED) {
                  s8 = null;
                }
                if (s8 !== peg$FAILED) {
                  s5 = [s5, s6, s7, s8];
                  s4 = s5;
                } else {
                  peg$currPos = s4;
                  s4 = peg$FAILED;
                }
              } else {
                peg$currPos = s4;
                s4 = peg$FAILED;
              }
            } else {
              peg$currPos = s4;
              s4 = peg$FAILED;
            }
          } else {
            peg$currPos = s4;
            s4 = peg$FAILED;
          }
          if (s4 === peg$FAILED) {
            s4 = null;
          }
          if (s4 !== peg$FAILED) {
            peg$savedPos = s0;
            s1 = peg$c124(s1, s3, s4);
            s0 = s1;
          } else {
            peg$currPos = s0;
            s0 = peg$FAILED;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }

    return s0;
  }

  function peg$parseUpdate1() {
    var s0;

    s0 = peg$parseLoad();
    if (s0 === peg$FAILED) {
      s0 = peg$parseClear();
      if (s0 === peg$FAILED) {
        s0 = peg$parseDrop();
        if (s0 === peg$FAILED) {
          s0 = peg$parseCreate();
          if (s0 === peg$FAILED) {
            s0 = peg$parseInsertData();
            if (s0 === peg$FAILED) {
              s0 = peg$parseDeleteData();
              if (s0 === peg$FAILED) {
                s0 = peg$parseDeleteWhere();
                if (s0 === peg$FAILED) {
                  s0 = peg$parseModify();
                }
              }
            }
          }
        }
      }
    }

    return s0;
  }

  function peg$parseLoad() {
    var s0, s1, s2, s3, s4, s5, s6, s7, s8;

    s0 = peg$currPos;
    if (input.substr(peg$currPos, 4) === peg$c125) {
      s1 = peg$c125;
      peg$currPos += 4;
    } else {
      s1 = peg$FAILED;
      if (peg$silentFails === 0) { peg$fail(peg$c126); }
    }
    if (s1 === peg$FAILED) {
      if (input.substr(peg$currPos, 4) === peg$c127) {
        s1 = peg$c127;
        peg$currPos += 4;
      } else {
        s1 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c128); }
      }
    }
    if (s1 !== peg$FAILED) {
      s2 = [];
      s3 = peg$parseWS();
      while (s3 !== peg$FAILED) {
        s2.push(s3);
        s3 = peg$parseWS();
      }
      if (s2 !== peg$FAILED) {
        s3 = peg$parseIRIref();
        if (s3 !== peg$FAILED) {
          s4 = [];
          s5 = peg$parseWS();
          while (s5 !== peg$FAILED) {
            s4.push(s5);
            s5 = peg$parseWS();
          }
          if (s4 !== peg$FAILED) {
            s5 = peg$currPos;
            if (input.substr(peg$currPos, 4) === peg$c129) {
              s6 = peg$c129;
              peg$currPos += 4;
            } else {
              s6 = peg$FAILED;
              if (peg$silentFails === 0) { peg$fail(peg$c130); }
            }
            if (s6 === peg$FAILED) {
              if (input.substr(peg$currPos, 4) === peg$c131) {
                s6 = peg$c131;
                peg$currPos += 4;
              } else {
                s6 = peg$FAILED;
                if (peg$silentFails === 0) { peg$fail(peg$c132); }
              }
            }
            if (s6 !== peg$FAILED) {
              s7 = [];
              s8 = peg$parseWS();
              while (s8 !== peg$FAILED) {
                s7.push(s8);
                s8 = peg$parseWS();
              }
              if (s7 !== peg$FAILED) {
                s8 = peg$parseGraphRef();
                if (s8 !== peg$FAILED) {
                  s6 = [s6, s7, s8];
                  s5 = s6;
                } else {
                  peg$currPos = s5;
                  s5 = peg$FAILED;
                }
              } else {
                peg$currPos = s5;
                s5 = peg$FAILED;
              }
            } else {
              peg$currPos = s5;
              s5 = peg$FAILED;
            }
            if (s5 === peg$FAILED) {
              s5 = null;
            }
            if (s5 !== peg$FAILED) {
              peg$savedPos = s0;
              s1 = peg$c133(s3, s5);
              s0 = s1;
            } else {
              peg$currPos = s0;
              s0 = peg$FAILED;
            }
          } else {
            peg$currPos = s0;
            s0 = peg$FAILED;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }

    return s0;
  }

  function peg$parseClear() {
    var s0, s1, s2, s3, s4, s5;

    s0 = peg$currPos;
    if (input.substr(peg$currPos, 5) === peg$c134) {
      s1 = peg$c134;
      peg$currPos += 5;
    } else {
      s1 = peg$FAILED;
      if (peg$silentFails === 0) { peg$fail(peg$c135); }
    }
    if (s1 === peg$FAILED) {
      if (input.substr(peg$currPos, 5) === peg$c136) {
        s1 = peg$c136;
        peg$currPos += 5;
      } else {
        s1 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c137); }
      }
    }
    if (s1 !== peg$FAILED) {
      s2 = [];
      s3 = peg$parseWS();
      while (s3 !== peg$FAILED) {
        s2.push(s3);
        s3 = peg$parseWS();
      }
      if (s2 !== peg$FAILED) {
        if (input.substr(peg$currPos, 6) === peg$c138) {
          s3 = peg$c138;
          peg$currPos += 6;
        } else {
          s3 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c139); }
        }
        if (s3 === peg$FAILED) {
          if (input.substr(peg$currPos, 6) === peg$c140) {
            s3 = peg$c140;
            peg$currPos += 6;
          } else {
            s3 = peg$FAILED;
            if (peg$silentFails === 0) { peg$fail(peg$c141); }
          }
        }
        if (s3 === peg$FAILED) {
          s3 = null;
        }
        if (s3 !== peg$FAILED) {
          s4 = [];
          s5 = peg$parseWS();
          while (s5 !== peg$FAILED) {
            s4.push(s5);
            s5 = peg$parseWS();
          }
          if (s4 !== peg$FAILED) {
            s5 = peg$parseGraphRefAll();
            if (s5 !== peg$FAILED) {
              peg$savedPos = s0;
              s1 = peg$c142(s5);
              s0 = s1;
            } else {
              peg$currPos = s0;
              s0 = peg$FAILED;
            }
          } else {
            peg$currPos = s0;
            s0 = peg$FAILED;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }

    return s0;
  }

  function peg$parseDrop() {
    var s0, s1, s2, s3, s4, s5;

    s0 = peg$currPos;
    if (input.substr(peg$currPos, 4) === peg$c143) {
      s1 = peg$c143;
      peg$currPos += 4;
    } else {
      s1 = peg$FAILED;
      if (peg$silentFails === 0) { peg$fail(peg$c144); }
    }
    if (s1 === peg$FAILED) {
      if (input.substr(peg$currPos, 4) === peg$c145) {
        s1 = peg$c145;
        peg$currPos += 4;
      } else {
        s1 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c146); }
      }
    }
    if (s1 !== peg$FAILED) {
      s2 = [];
      s3 = peg$parseWS();
      while (s3 !== peg$FAILED) {
        s2.push(s3);
        s3 = peg$parseWS();
      }
      if (s2 !== peg$FAILED) {
        if (input.substr(peg$currPos, 6) === peg$c138) {
          s3 = peg$c138;
          peg$currPos += 6;
        } else {
          s3 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c139); }
        }
        if (s3 === peg$FAILED) {
          if (input.substr(peg$currPos, 6) === peg$c140) {
            s3 = peg$c140;
            peg$currPos += 6;
          } else {
            s3 = peg$FAILED;
            if (peg$silentFails === 0) { peg$fail(peg$c141); }
          }
        }
        if (s3 === peg$FAILED) {
          s3 = null;
        }
        if (s3 !== peg$FAILED) {
          s4 = [];
          s5 = peg$parseWS();
          while (s5 !== peg$FAILED) {
            s4.push(s5);
            s5 = peg$parseWS();
          }
          if (s4 !== peg$FAILED) {
            s5 = peg$parseGraphRefAll();
            if (s5 !== peg$FAILED) {
              peg$savedPos = s0;
              s1 = peg$c147(s5);
              s0 = s1;
            } else {
              peg$currPos = s0;
              s0 = peg$FAILED;
            }
          } else {
            peg$currPos = s0;
            s0 = peg$FAILED;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }

    return s0;
  }

  function peg$parseCreate() {
    var s0, s1, s2, s3, s4, s5;

    s0 = peg$currPos;
    if (input.substr(peg$currPos, 6) === peg$c148) {
      s1 = peg$c148;
      peg$currPos += 6;
    } else {
      s1 = peg$FAILED;
      if (peg$silentFails === 0) { peg$fail(peg$c149); }
    }
    if (s1 === peg$FAILED) {
      if (input.substr(peg$currPos, 6) === peg$c150) {
        s1 = peg$c150;
        peg$currPos += 6;
      } else {
        s1 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c151); }
      }
    }
    if (s1 !== peg$FAILED) {
      s2 = [];
      s3 = peg$parseWS();
      while (s3 !== peg$FAILED) {
        s2.push(s3);
        s3 = peg$parseWS();
      }
      if (s2 !== peg$FAILED) {
        if (input.substr(peg$currPos, 6) === peg$c138) {
          s3 = peg$c138;
          peg$currPos += 6;
        } else {
          s3 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c139); }
        }
        if (s3 === peg$FAILED) {
          if (input.substr(peg$currPos, 6) === peg$c140) {
            s3 = peg$c140;
            peg$currPos += 6;
          } else {
            s3 = peg$FAILED;
            if (peg$silentFails === 0) { peg$fail(peg$c141); }
          }
        }
        if (s3 === peg$FAILED) {
          s3 = null;
        }
        if (s3 !== peg$FAILED) {
          s4 = [];
          s5 = peg$parseWS();
          while (s5 !== peg$FAILED) {
            s4.push(s5);
            s5 = peg$parseWS();
          }
          if (s4 !== peg$FAILED) {
            s5 = peg$parseGraphRef();
            if (s5 !== peg$FAILED) {
              peg$savedPos = s0;
              s1 = peg$c152(s5);
              s0 = s1;
            } else {
              peg$currPos = s0;
              s0 = peg$FAILED;
            }
          } else {
            peg$currPos = s0;
            s0 = peg$FAILED;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }

    return s0;
  }

  function peg$parseInsertData() {
    var s0, s1, s2, s3, s4, s5;

    s0 = peg$currPos;
    if (input.substr(peg$currPos, 6) === peg$c153) {
      s1 = peg$c153;
      peg$currPos += 6;
    } else {
      s1 = peg$FAILED;
      if (peg$silentFails === 0) { peg$fail(peg$c154); }
    }
    if (s1 === peg$FAILED) {
      if (input.substr(peg$currPos, 6) === peg$c155) {
        s1 = peg$c155;
        peg$currPos += 6;
      } else {
        s1 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c156); }
      }
    }
    if (s1 !== peg$FAILED) {
      s2 = [];
      s3 = peg$parseWS();
      while (s3 !== peg$FAILED) {
        s2.push(s3);
        s3 = peg$parseWS();
      }
      if (s2 !== peg$FAILED) {
        if (input.substr(peg$currPos, 4) === peg$c157) {
          s3 = peg$c157;
          peg$currPos += 4;
        } else {
          s3 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c158); }
        }
        if (s3 === peg$FAILED) {
          if (input.substr(peg$currPos, 4) === peg$c159) {
            s3 = peg$c159;
            peg$currPos += 4;
          } else {
            s3 = peg$FAILED;
            if (peg$silentFails === 0) { peg$fail(peg$c160); }
          }
        }
        if (s3 !== peg$FAILED) {
          s4 = [];
          s5 = peg$parseWS();
          while (s5 !== peg$FAILED) {
            s4.push(s5);
            s5 = peg$parseWS();
          }
          if (s4 !== peg$FAILED) {
            s5 = peg$parseQuadData();
            if (s5 !== peg$FAILED) {
              peg$savedPos = s0;
              s1 = peg$c161(s5);
              s0 = s1;
            } else {
              peg$currPos = s0;
              s0 = peg$FAILED;
            }
          } else {
            peg$currPos = s0;
            s0 = peg$FAILED;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }

    return s0;
  }

  function peg$parseDeleteData() {
    var s0, s1, s2, s3, s4;

    s0 = peg$currPos;
    if (input.substr(peg$currPos, 6) === peg$c162) {
      s1 = peg$c162;
      peg$currPos += 6;
    } else {
      s1 = peg$FAILED;
      if (peg$silentFails === 0) { peg$fail(peg$c163); }
    }
    if (s1 === peg$FAILED) {
      if (input.substr(peg$currPos, 6) === peg$c164) {
        s1 = peg$c164;
        peg$currPos += 6;
      } else {
        s1 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c165); }
      }
    }
    if (s1 !== peg$FAILED) {
      s2 = [];
      s3 = peg$parseWS();
      while (s3 !== peg$FAILED) {
        s2.push(s3);
        s3 = peg$parseWS();
      }
      if (s2 !== peg$FAILED) {
        if (input.substr(peg$currPos, 4) === peg$c157) {
          s3 = peg$c157;
          peg$currPos += 4;
        } else {
          s3 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c158); }
        }
        if (s3 === peg$FAILED) {
          if (input.substr(peg$currPos, 4) === peg$c159) {
            s3 = peg$c159;
            peg$currPos += 4;
          } else {
            s3 = peg$FAILED;
            if (peg$silentFails === 0) { peg$fail(peg$c160); }
          }
        }
        if (s3 !== peg$FAILED) {
          s4 = peg$parseQuadData();
          if (s4 !== peg$FAILED) {
            peg$savedPos = s0;
            s1 = peg$c166(s4);
            s0 = s1;
          } else {
            peg$currPos = s0;
            s0 = peg$FAILED;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }

    return s0;
  }

  function peg$parseDeleteWhere() {
    var s0, s1, s2, s3, s4, s5;

    s0 = peg$currPos;
    if (input.substr(peg$currPos, 6) === peg$c162) {
      s1 = peg$c162;
      peg$currPos += 6;
    } else {
      s1 = peg$FAILED;
      if (peg$silentFails === 0) { peg$fail(peg$c163); }
    }
    if (s1 === peg$FAILED) {
      if (input.substr(peg$currPos, 6) === peg$c164) {
        s1 = peg$c164;
        peg$currPos += 6;
      } else {
        s1 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c165); }
      }
    }
    if (s1 !== peg$FAILED) {
      s2 = [];
      s3 = peg$parseWS();
      while (s3 !== peg$FAILED) {
        s2.push(s3);
        s3 = peg$parseWS();
      }
      if (s2 !== peg$FAILED) {
        if (input.substr(peg$currPos, 5) === peg$c43) {
          s3 = peg$c43;
          peg$currPos += 5;
        } else {
          s3 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c44); }
        }
        if (s3 === peg$FAILED) {
          if (input.substr(peg$currPos, 5) === peg$c45) {
            s3 = peg$c45;
            peg$currPos += 5;
          } else {
            s3 = peg$FAILED;
            if (peg$silentFails === 0) { peg$fail(peg$c46); }
          }
        }
        if (s3 !== peg$FAILED) {
          s4 = [];
          s5 = peg$parseWS();
          while (s5 !== peg$FAILED) {
            s4.push(s5);
            s5 = peg$parseWS();
          }
          if (s4 !== peg$FAILED) {
            s5 = peg$parseGroupGraphPattern();
            if (s5 !== peg$FAILED) {
              peg$savedPos = s0;
              s1 = peg$c167(s5);
              s0 = s1;
            } else {
              peg$currPos = s0;
              s0 = peg$FAILED;
            }
          } else {
            peg$currPos = s0;
            s0 = peg$FAILED;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }

    return s0;
  }

  function peg$parseModify() {
    var s0, s1, s2, s3, s4, s5, s6, s7, s8, s9, s10, s11;

    s0 = peg$currPos;
    s1 = peg$currPos;
    if (input.substr(peg$currPos, 4) === peg$c168) {
      s2 = peg$c168;
      peg$currPos += 4;
    } else {
      s2 = peg$FAILED;
      if (peg$silentFails === 0) { peg$fail(peg$c169); }
    }
    if (s2 === peg$FAILED) {
      if (input.substr(peg$currPos, 4) === peg$c170) {
        s2 = peg$c170;
        peg$currPos += 4;
      } else {
        s2 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c171); }
      }
    }
    if (s2 !== peg$FAILED) {
      s3 = [];
      s4 = peg$parseWS();
      while (s4 !== peg$FAILED) {
        s3.push(s4);
        s4 = peg$parseWS();
      }
      if (s3 !== peg$FAILED) {
        s4 = peg$parseIRIref();
        if (s4 !== peg$FAILED) {
          s2 = [s2, s3, s4];
          s1 = s2;
        } else {
          peg$currPos = s1;
          s1 = peg$FAILED;
        }
      } else {
        peg$currPos = s1;
        s1 = peg$FAILED;
      }
    } else {
      peg$currPos = s1;
      s1 = peg$FAILED;
    }
    if (s1 === peg$FAILED) {
      s1 = null;
    }
    if (s1 !== peg$FAILED) {
      s2 = [];
      s3 = peg$parseWS();
      while (s3 !== peg$FAILED) {
        s2.push(s3);
        s3 = peg$parseWS();
      }
      if (s2 !== peg$FAILED) {
        s3 = peg$currPos;
        s4 = peg$parseDeleteClause();
        if (s4 !== peg$FAILED) {
          s5 = [];
          s6 = peg$parseWS();
          while (s6 !== peg$FAILED) {
            s5.push(s6);
            s6 = peg$parseWS();
          }
          if (s5 !== peg$FAILED) {
            s6 = peg$parseInsertClause();
            if (s6 === peg$FAILED) {
              s6 = null;
            }
            if (s6 !== peg$FAILED) {
              s4 = [s4, s5, s6];
              s3 = s4;
            } else {
              peg$currPos = s3;
              s3 = peg$FAILED;
            }
          } else {
            peg$currPos = s3;
            s3 = peg$FAILED;
          }
        } else {
          peg$currPos = s3;
          s3 = peg$FAILED;
        }
        if (s3 === peg$FAILED) {
          s3 = peg$parseInsertClause();
        }
        if (s3 !== peg$FAILED) {
          s4 = [];
          s5 = peg$parseWS();
          while (s5 !== peg$FAILED) {
            s4.push(s5);
            s5 = peg$parseWS();
          }
          if (s4 !== peg$FAILED) {
            s5 = [];
            s6 = peg$parseUsingClause();
            while (s6 !== peg$FAILED) {
              s5.push(s6);
              s6 = peg$parseUsingClause();
            }
            if (s5 !== peg$FAILED) {
              s6 = [];
              s7 = peg$parseWS();
              while (s7 !== peg$FAILED) {
                s6.push(s7);
                s7 = peg$parseWS();
              }
              if (s6 !== peg$FAILED) {
                if (input.substr(peg$currPos, 5) === peg$c43) {
                  s7 = peg$c43;
                  peg$currPos += 5;
                } else {
                  s7 = peg$FAILED;
                  if (peg$silentFails === 0) { peg$fail(peg$c44); }
                }
                if (s7 === peg$FAILED) {
                  if (input.substr(peg$currPos, 5) === peg$c45) {
                    s7 = peg$c45;
                    peg$currPos += 5;
                  } else {
                    s7 = peg$FAILED;
                    if (peg$silentFails === 0) { peg$fail(peg$c46); }
                  }
                }
                if (s7 !== peg$FAILED) {
                  s8 = [];
                  s9 = peg$parseWS();
                  while (s9 !== peg$FAILED) {
                    s8.push(s9);
                    s9 = peg$parseWS();
                  }
                  if (s8 !== peg$FAILED) {
                    s9 = peg$parseGroupGraphPattern();
                    if (s9 !== peg$FAILED) {
                      s10 = [];
                      s11 = peg$parseWS();
                      while (s11 !== peg$FAILED) {
                        s10.push(s11);
                        s11 = peg$parseWS();
                      }
                      if (s10 !== peg$FAILED) {
                        peg$savedPos = s0;
                        s1 = peg$c172(s1, s3, s5, s9);
                        s0 = s1;
                      } else {
                        peg$currPos = s0;
                        s0 = peg$FAILED;
                      }
                    } else {
                      peg$currPos = s0;
                      s0 = peg$FAILED;
                    }
                  } else {
                    peg$currPos = s0;
                    s0 = peg$FAILED;
                  }
                } else {
                  peg$currPos = s0;
                  s0 = peg$FAILED;
                }
              } else {
                peg$currPos = s0;
                s0 = peg$FAILED;
              }
            } else {
              peg$currPos = s0;
              s0 = peg$FAILED;
            }
          } else {
            peg$currPos = s0;
            s0 = peg$FAILED;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }

    return s0;
  }

  function peg$parseDeleteClause() {
    var s0, s1, s2;

    s0 = peg$currPos;
    if (input.substr(peg$currPos, 6) === peg$c162) {
      s1 = peg$c162;
      peg$currPos += 6;
    } else {
      s1 = peg$FAILED;
      if (peg$silentFails === 0) { peg$fail(peg$c163); }
    }
    if (s1 === peg$FAILED) {
      if (input.substr(peg$currPos, 6) === peg$c164) {
        s1 = peg$c164;
        peg$currPos += 6;
      } else {
        s1 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c165); }
      }
    }
    if (s1 !== peg$FAILED) {
      s2 = peg$parseQuadPattern();
      if (s2 !== peg$FAILED) {
        peg$savedPos = s0;
        s1 = peg$c173(s2);
        s0 = s1;
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }

    return s0;
  }

  function peg$parseInsertClause() {
    var s0, s1, s2;

    s0 = peg$currPos;
    if (input.substr(peg$currPos, 6) === peg$c153) {
      s1 = peg$c153;
      peg$currPos += 6;
    } else {
      s1 = peg$FAILED;
      if (peg$silentFails === 0) { peg$fail(peg$c154); }
    }
    if (s1 === peg$FAILED) {
      if (input.substr(peg$currPos, 6) === peg$c155) {
        s1 = peg$c155;
        peg$currPos += 6;
      } else {
        s1 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c156); }
      }
    }
    if (s1 !== peg$FAILED) {
      s2 = peg$parseQuadPattern();
      if (s2 !== peg$FAILED) {
        peg$savedPos = s0;
        s1 = peg$c173(s2);
        s0 = s1;
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }

    return s0;
  }

  function peg$parseUsingClause() {
    var s0, s1, s2, s3, s4, s5, s6, s7;

    s0 = peg$currPos;
    s1 = [];
    s2 = peg$parseWS();
    while (s2 !== peg$FAILED) {
      s1.push(s2);
      s2 = peg$parseWS();
    }
    if (s1 !== peg$FAILED) {
      if (input.substr(peg$currPos, 5) === peg$c174) {
        s2 = peg$c174;
        peg$currPos += 5;
      } else {
        s2 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c175); }
      }
      if (s2 === peg$FAILED) {
        if (input.substr(peg$currPos, 5) === peg$c176) {
          s2 = peg$c176;
          peg$currPos += 5;
        } else {
          s2 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c177); }
        }
      }
      if (s2 !== peg$FAILED) {
        s3 = [];
        s4 = peg$parseWS();
        while (s4 !== peg$FAILED) {
          s3.push(s4);
          s4 = peg$parseWS();
        }
        if (s3 !== peg$FAILED) {
          s4 = peg$parseIRIref();
          if (s4 === peg$FAILED) {
            s4 = peg$currPos;
            if (input.substr(peg$currPos, 5) === peg$c65) {
              s5 = peg$c65;
              peg$currPos += 5;
            } else {
              s5 = peg$FAILED;
              if (peg$silentFails === 0) { peg$fail(peg$c66); }
            }
            if (s5 === peg$FAILED) {
              if (input.substr(peg$currPos, 5) === peg$c67) {
                s5 = peg$c67;
                peg$currPos += 5;
              } else {
                s5 = peg$FAILED;
                if (peg$silentFails === 0) { peg$fail(peg$c68); }
              }
            }
            if (s5 !== peg$FAILED) {
              s6 = [];
              s7 = peg$parseWS();
              while (s7 !== peg$FAILED) {
                s6.push(s7);
                s7 = peg$parseWS();
              }
              if (s6 !== peg$FAILED) {
                s7 = peg$parseIRIref();
                if (s7 !== peg$FAILED) {
                  s5 = [s5, s6, s7];
                  s4 = s5;
                } else {
                  peg$currPos = s4;
                  s4 = peg$FAILED;
                }
              } else {
                peg$currPos = s4;
                s4 = peg$FAILED;
              }
            } else {
              peg$currPos = s4;
              s4 = peg$FAILED;
            }
          }
          if (s4 !== peg$FAILED) {
            peg$savedPos = s0;
            s1 = peg$c178(s4);
            s0 = s1;
          } else {
            peg$currPos = s0;
            s0 = peg$FAILED;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }

    return s0;
  }

  function peg$parseGraphRef() {
    var s0, s1, s2, s3;

    s0 = peg$currPos;
    if (input.substr(peg$currPos, 5) === peg$c179) {
      s1 = peg$c179;
      peg$currPos += 5;
    } else {
      s1 = peg$FAILED;
      if (peg$silentFails === 0) { peg$fail(peg$c180); }
    }
    if (s1 === peg$FAILED) {
      if (input.substr(peg$currPos, 5) === peg$c181) {
        s1 = peg$c181;
        peg$currPos += 5;
      } else {
        s1 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c182); }
      }
    }
    if (s1 !== peg$FAILED) {
      s2 = [];
      s3 = peg$parseWS();
      while (s3 !== peg$FAILED) {
        s2.push(s3);
        s3 = peg$parseWS();
      }
      if (s2 !== peg$FAILED) {
        s3 = peg$parseIRIref();
        if (s3 !== peg$FAILED) {
          peg$savedPos = s0;
          s1 = peg$c183(s3);
          s0 = s1;
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }

    return s0;
  }

  function peg$parseGraphRefAll() {
    var s0, s1;

    s0 = peg$currPos;
    s1 = peg$parseGraphRef();
    if (s1 !== peg$FAILED) {
      peg$savedPos = s0;
      s1 = peg$c70(s1);
    }
    s0 = s1;
    if (s0 === peg$FAILED) {
      s0 = peg$currPos;
      if (input.substr(peg$currPos, 7) === peg$c184) {
        s1 = peg$c184;
        peg$currPos += 7;
      } else {
        s1 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c185); }
      }
      if (s1 === peg$FAILED) {
        if (input.substr(peg$currPos, 7) === peg$c186) {
          s1 = peg$c186;
          peg$currPos += 7;
        } else {
          s1 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c187); }
        }
      }
      if (s1 !== peg$FAILED) {
        peg$savedPos = s0;
        s1 = peg$c188();
      }
      s0 = s1;
      if (s0 === peg$FAILED) {
        s0 = peg$currPos;
        if (input.substr(peg$currPos, 5) === peg$c65) {
          s1 = peg$c65;
          peg$currPos += 5;
        } else {
          s1 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c66); }
        }
        if (s1 === peg$FAILED) {
          if (input.substr(peg$currPos, 5) === peg$c67) {
            s1 = peg$c67;
            peg$currPos += 5;
          } else {
            s1 = peg$FAILED;
            if (peg$silentFails === 0) { peg$fail(peg$c68); }
          }
        }
        if (s1 !== peg$FAILED) {
          peg$savedPos = s0;
          s1 = peg$c189();
        }
        s0 = s1;
        if (s0 === peg$FAILED) {
          s0 = peg$currPos;
          if (input.substr(peg$currPos, 3) === peg$c190) {
            s1 = peg$c190;
            peg$currPos += 3;
          } else {
            s1 = peg$FAILED;
            if (peg$silentFails === 0) { peg$fail(peg$c191); }
          }
          if (s1 === peg$FAILED) {
            if (input.substr(peg$currPos, 3) === peg$c192) {
              s1 = peg$c192;
              peg$currPos += 3;
            } else {
              s1 = peg$FAILED;
              if (peg$silentFails === 0) { peg$fail(peg$c193); }
            }
          }
          if (s1 !== peg$FAILED) {
            peg$savedPos = s0;
            s1 = peg$c194();
          }
          s0 = s1;
        }
      }
    }

    return s0;
  }

  function peg$parseQuadPattern() {
    var s0, s1, s2, s3, s4, s5, s6, s7, s8;

    s0 = peg$currPos;
    s1 = [];
    s2 = peg$parseWS();
    while (s2 !== peg$FAILED) {
      s1.push(s2);
      s2 = peg$parseWS();
    }
    if (s1 !== peg$FAILED) {
      if (input.charCodeAt(peg$currPos) === 123) {
        s2 = peg$c47;
        peg$currPos++;
      } else {
        s2 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c48); }
      }
      if (s2 !== peg$FAILED) {
        s3 = [];
        s4 = peg$parseWS();
        while (s4 !== peg$FAILED) {
          s3.push(s4);
          s4 = peg$parseWS();
        }
        if (s3 !== peg$FAILED) {
          s4 = peg$parseQuads();
          if (s4 !== peg$FAILED) {
            s5 = [];
            s6 = peg$parseWS();
            while (s6 !== peg$FAILED) {
              s5.push(s6);
              s6 = peg$parseWS();
            }
            if (s5 !== peg$FAILED) {
              if (input.charCodeAt(peg$currPos) === 125) {
                s6 = peg$c49;
                peg$currPos++;
              } else {
                s6 = peg$FAILED;
                if (peg$silentFails === 0) { peg$fail(peg$c50); }
              }
              if (s6 !== peg$FAILED) {
                s7 = [];
                s8 = peg$parseWS();
                while (s8 !== peg$FAILED) {
                  s7.push(s8);
                  s8 = peg$parseWS();
                }
                if (s7 !== peg$FAILED) {
                  peg$savedPos = s0;
                  s1 = peg$c195(s4);
                  s0 = s1;
                } else {
                  peg$currPos = s0;
                  s0 = peg$FAILED;
                }
              } else {
                peg$currPos = s0;
                s0 = peg$FAILED;
              }
            } else {
              peg$currPos = s0;
              s0 = peg$FAILED;
            }
          } else {
            peg$currPos = s0;
            s0 = peg$FAILED;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }

    return s0;
  }

  function peg$parseQuadData() {
    var s0, s1, s2, s3, s4, s5, s6, s7, s8;

    s0 = peg$currPos;
    s1 = [];
    s2 = peg$parseWS();
    while (s2 !== peg$FAILED) {
      s1.push(s2);
      s2 = peg$parseWS();
    }
    if (s1 !== peg$FAILED) {
      if (input.charCodeAt(peg$currPos) === 123) {
        s2 = peg$c47;
        peg$currPos++;
      } else {
        s2 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c48); }
      }
      if (s2 !== peg$FAILED) {
        s3 = [];
        s4 = peg$parseWS();
        while (s4 !== peg$FAILED) {
          s3.push(s4);
          s4 = peg$parseWS();
        }
        if (s3 !== peg$FAILED) {
          s4 = peg$parseQuads();
          if (s4 !== peg$FAILED) {
            s5 = [];
            s6 = peg$parseWS();
            while (s6 !== peg$FAILED) {
              s5.push(s6);
              s6 = peg$parseWS();
            }
            if (s5 !== peg$FAILED) {
              if (input.charCodeAt(peg$currPos) === 125) {
                s6 = peg$c49;
                peg$currPos++;
              } else {
                s6 = peg$FAILED;
                if (peg$silentFails === 0) { peg$fail(peg$c50); }
              }
              if (s6 !== peg$FAILED) {
                s7 = [];
                s8 = peg$parseWS();
                while (s8 !== peg$FAILED) {
                  s7.push(s8);
                  s8 = peg$parseWS();
                }
                if (s7 !== peg$FAILED) {
                  peg$savedPos = s0;
                  s1 = peg$c195(s4);
                  s0 = s1;
                } else {
                  peg$currPos = s0;
                  s0 = peg$FAILED;
                }
              } else {
                peg$currPos = s0;
                s0 = peg$FAILED;
              }
            } else {
              peg$currPos = s0;
              s0 = peg$FAILED;
            }
          } else {
            peg$currPos = s0;
            s0 = peg$FAILED;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }

    return s0;
  }

  function peg$parseQuads() {
    var s0, s1, s2, s3, s4, s5, s6;

    s0 = peg$currPos;
    s1 = peg$parseTriplesTemplate();
    if (s1 === peg$FAILED) {
      s1 = null;
    }
    if (s1 !== peg$FAILED) {
      s2 = [];
      s3 = peg$currPos;
      s4 = peg$parseQuadsNotTriples();
      if (s4 !== peg$FAILED) {
        if (input.charCodeAt(peg$currPos) === 46) {
          s5 = peg$c196;
          peg$currPos++;
        } else {
          s5 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c197); }
        }
        if (s5 === peg$FAILED) {
          s5 = null;
        }
        if (s5 !== peg$FAILED) {
          s6 = peg$parseTriplesTemplate();
          if (s6 === peg$FAILED) {
            s6 = null;
          }
          if (s6 !== peg$FAILED) {
            s4 = [s4, s5, s6];
            s3 = s4;
          } else {
            peg$currPos = s3;
            s3 = peg$FAILED;
          }
        } else {
          peg$currPos = s3;
          s3 = peg$FAILED;
        }
      } else {
        peg$currPos = s3;
        s3 = peg$FAILED;
      }
      while (s3 !== peg$FAILED) {
        s2.push(s3);
        s3 = peg$currPos;
        s4 = peg$parseQuadsNotTriples();
        if (s4 !== peg$FAILED) {
          if (input.charCodeAt(peg$currPos) === 46) {
            s5 = peg$c196;
            peg$currPos++;
          } else {
            s5 = peg$FAILED;
            if (peg$silentFails === 0) { peg$fail(peg$c197); }
          }
          if (s5 === peg$FAILED) {
            s5 = null;
          }
          if (s5 !== peg$FAILED) {
            s6 = peg$parseTriplesTemplate();
            if (s6 === peg$FAILED) {
              s6 = null;
            }
            if (s6 !== peg$FAILED) {
              s4 = [s4, s5, s6];
              s3 = s4;
            } else {
              peg$currPos = s3;
              s3 = peg$FAILED;
            }
          } else {
            peg$currPos = s3;
            s3 = peg$FAILED;
          }
        } else {
          peg$currPos = s3;
          s3 = peg$FAILED;
        }
      }
      if (s2 !== peg$FAILED) {
        peg$savedPos = s0;
        s1 = peg$c198(s1, s2);
        s0 = s1;
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }

    return s0;
  }

  function peg$parseQuadsNotTriples() {
    var s0, s1, s2, s3, s4, s5, s6, s7, s8, s9, s10, s11, s12;

    s0 = peg$currPos;
    s1 = [];
    s2 = peg$parseWS();
    while (s2 !== peg$FAILED) {
      s1.push(s2);
      s2 = peg$parseWS();
    }
    if (s1 !== peg$FAILED) {
      if (input.substr(peg$currPos, 5) === peg$c179) {
        s2 = peg$c179;
        peg$currPos += 5;
      } else {
        s2 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c180); }
      }
      if (s2 === peg$FAILED) {
        if (input.substr(peg$currPos, 5) === peg$c181) {
          s2 = peg$c181;
          peg$currPos += 5;
        } else {
          s2 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c182); }
        }
      }
      if (s2 !== peg$FAILED) {
        s3 = [];
        s4 = peg$parseWS();
        while (s4 !== peg$FAILED) {
          s3.push(s4);
          s4 = peg$parseWS();
        }
        if (s3 !== peg$FAILED) {
          s4 = peg$parseVarOrIRIref();
          if (s4 !== peg$FAILED) {
            s5 = [];
            s6 = peg$parseWS();
            while (s6 !== peg$FAILED) {
              s5.push(s6);
              s6 = peg$parseWS();
            }
            if (s5 !== peg$FAILED) {
              if (input.charCodeAt(peg$currPos) === 123) {
                s6 = peg$c47;
                peg$currPos++;
              } else {
                s6 = peg$FAILED;
                if (peg$silentFails === 0) { peg$fail(peg$c48); }
              }
              if (s6 !== peg$FAILED) {
                s7 = [];
                s8 = peg$parseWS();
                while (s8 !== peg$FAILED) {
                  s7.push(s8);
                  s8 = peg$parseWS();
                }
                if (s7 !== peg$FAILED) {
                  s8 = peg$parseTriplesTemplate();
                  if (s8 === peg$FAILED) {
                    s8 = null;
                  }
                  if (s8 !== peg$FAILED) {
                    s9 = [];
                    s10 = peg$parseWS();
                    while (s10 !== peg$FAILED) {
                      s9.push(s10);
                      s10 = peg$parseWS();
                    }
                    if (s9 !== peg$FAILED) {
                      if (input.charCodeAt(peg$currPos) === 125) {
                        s10 = peg$c49;
                        peg$currPos++;
                      } else {
                        s10 = peg$FAILED;
                        if (peg$silentFails === 0) { peg$fail(peg$c50); }
                      }
                      if (s10 !== peg$FAILED) {
                        s11 = [];
                        s12 = peg$parseWS();
                        while (s12 !== peg$FAILED) {
                          s11.push(s12);
                          s12 = peg$parseWS();
                        }
                        if (s11 !== peg$FAILED) {
                          peg$savedPos = s0;
                          s1 = peg$c199(s4, s8);
                          s0 = s1;
                        } else {
                          peg$currPos = s0;
                          s0 = peg$FAILED;
                        }
                      } else {
                        peg$currPos = s0;
                        s0 = peg$FAILED;
                      }
                    } else {
                      peg$currPos = s0;
                      s0 = peg$FAILED;
                    }
                  } else {
                    peg$currPos = s0;
                    s0 = peg$FAILED;
                  }
                } else {
                  peg$currPos = s0;
                  s0 = peg$FAILED;
                }
              } else {
                peg$currPos = s0;
                s0 = peg$FAILED;
              }
            } else {
              peg$currPos = s0;
              s0 = peg$FAILED;
            }
          } else {
            peg$currPos = s0;
            s0 = peg$FAILED;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }

    return s0;
  }

  function peg$parseTriplesTemplate() {
    var s0, s1, s2, s3, s4, s5, s6;

    s0 = peg$currPos;
    s1 = peg$parseTriplesSameSubject();
    if (s1 !== peg$FAILED) {
      s2 = peg$currPos;
      s3 = [];
      s4 = peg$parseWS();
      while (s4 !== peg$FAILED) {
        s3.push(s4);
        s4 = peg$parseWS();
      }
      if (s3 !== peg$FAILED) {
        if (input.charCodeAt(peg$currPos) === 46) {
          s4 = peg$c196;
          peg$currPos++;
        } else {
          s4 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c197); }
        }
        if (s4 !== peg$FAILED) {
          s5 = [];
          s6 = peg$parseWS();
          while (s6 !== peg$FAILED) {
            s5.push(s6);
            s6 = peg$parseWS();
          }
          if (s5 !== peg$FAILED) {
            s6 = peg$parseTriplesTemplate();
            if (s6 === peg$FAILED) {
              s6 = null;
            }
            if (s6 !== peg$FAILED) {
              s3 = [s3, s4, s5, s6];
              s2 = s3;
            } else {
              peg$currPos = s2;
              s2 = peg$FAILED;
            }
          } else {
            peg$currPos = s2;
            s2 = peg$FAILED;
          }
        } else {
          peg$currPos = s2;
          s2 = peg$FAILED;
        }
      } else {
        peg$currPos = s2;
        s2 = peg$FAILED;
      }
      if (s2 === peg$FAILED) {
        s2 = null;
      }
      if (s2 !== peg$FAILED) {
        peg$savedPos = s0;
        s1 = peg$c200(s1, s2);
        s0 = s1;
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }

    return s0;
  }

  function peg$parseGroupGraphPattern() {
    var s0, s1, s2, s3, s4, s5;

    s0 = peg$currPos;
    if (input.charCodeAt(peg$currPos) === 123) {
      s1 = peg$c47;
      peg$currPos++;
    } else {
      s1 = peg$FAILED;
      if (peg$silentFails === 0) { peg$fail(peg$c48); }
    }
    if (s1 !== peg$FAILED) {
      s2 = [];
      s3 = peg$parseWS();
      while (s3 !== peg$FAILED) {
        s2.push(s3);
        s3 = peg$parseWS();
      }
      if (s2 !== peg$FAILED) {
        s3 = peg$parseSubSelect();
        if (s3 !== peg$FAILED) {
          s4 = [];
          s5 = peg$parseWS();
          while (s5 !== peg$FAILED) {
            s4.push(s5);
            s5 = peg$parseWS();
          }
          if (s4 !== peg$FAILED) {
            if (input.charCodeAt(peg$currPos) === 125) {
              s5 = peg$c49;
              peg$currPos++;
            } else {
              s5 = peg$FAILED;
              if (peg$silentFails === 0) { peg$fail(peg$c50); }
            }
            if (s5 !== peg$FAILED) {
              peg$savedPos = s0;
              s1 = peg$c201(s3);
              s0 = s1;
            } else {
              peg$currPos = s0;
              s0 = peg$FAILED;
            }
          } else {
            peg$currPos = s0;
            s0 = peg$FAILED;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }
    if (s0 === peg$FAILED) {
      s0 = peg$currPos;
      if (input.charCodeAt(peg$currPos) === 123) {
        s1 = peg$c47;
        peg$currPos++;
      } else {
        s1 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c48); }
      }
      if (s1 !== peg$FAILED) {
        s2 = [];
        s3 = peg$parseWS();
        while (s3 !== peg$FAILED) {
          s2.push(s3);
          s3 = peg$parseWS();
        }
        if (s2 !== peg$FAILED) {
          s3 = peg$parseGroupGraphPatternSub();
          if (s3 !== peg$FAILED) {
            s4 = [];
            s5 = peg$parseWS();
            while (s5 !== peg$FAILED) {
              s4.push(s5);
              s5 = peg$parseWS();
            }
            if (s4 !== peg$FAILED) {
              if (input.charCodeAt(peg$currPos) === 125) {
                s5 = peg$c49;
                peg$currPos++;
              } else {
                s5 = peg$FAILED;
                if (peg$silentFails === 0) { peg$fail(peg$c50); }
              }
              if (s5 !== peg$FAILED) {
                peg$savedPos = s0;
                s1 = peg$c201(s3);
                s0 = s1;
              } else {
                peg$currPos = s0;
                s0 = peg$FAILED;
              }
            } else {
              peg$currPos = s0;
              s0 = peg$FAILED;
            }
          } else {
            peg$currPos = s0;
            s0 = peg$FAILED;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    }

    return s0;
  }

  function peg$parseGroupGraphPatternSub() {
    var s0, s1, s2, s3, s4, s5, s6, s7, s8, s9;

    s0 = peg$currPos;
    s1 = peg$parseTriplesBlock();
    if (s1 === peg$FAILED) {
      s1 = null;
    }
    if (s1 !== peg$FAILED) {
      s2 = [];
      s3 = peg$parseWS();
      while (s3 !== peg$FAILED) {
        s2.push(s3);
        s3 = peg$parseWS();
      }
      if (s2 !== peg$FAILED) {
        s3 = [];
        s4 = peg$currPos;
        s5 = peg$parseGraphPatternNotTriples();
        if (s5 !== peg$FAILED) {
          s6 = [];
          s7 = peg$parseWS();
          while (s7 !== peg$FAILED) {
            s6.push(s7);
            s7 = peg$parseWS();
          }
          if (s6 !== peg$FAILED) {
            if (input.charCodeAt(peg$currPos) === 46) {
              s7 = peg$c196;
              peg$currPos++;
            } else {
              s7 = peg$FAILED;
              if (peg$silentFails === 0) { peg$fail(peg$c197); }
            }
            if (s7 === peg$FAILED) {
              s7 = null;
            }
            if (s7 !== peg$FAILED) {
              s8 = [];
              s9 = peg$parseWS();
              while (s9 !== peg$FAILED) {
                s8.push(s9);
                s9 = peg$parseWS();
              }
              if (s8 !== peg$FAILED) {
                s9 = peg$parseTriplesBlock();
                if (s9 === peg$FAILED) {
                  s9 = null;
                }
                if (s9 !== peg$FAILED) {
                  s5 = [s5, s6, s7, s8, s9];
                  s4 = s5;
                } else {
                  peg$currPos = s4;
                  s4 = peg$FAILED;
                }
              } else {
                peg$currPos = s4;
                s4 = peg$FAILED;
              }
            } else {
              peg$currPos = s4;
              s4 = peg$FAILED;
            }
          } else {
            peg$currPos = s4;
            s4 = peg$FAILED;
          }
        } else {
          peg$currPos = s4;
          s4 = peg$FAILED;
        }
        while (s4 !== peg$FAILED) {
          s3.push(s4);
          s4 = peg$currPos;
          s5 = peg$parseGraphPatternNotTriples();
          if (s5 !== peg$FAILED) {
            s6 = [];
            s7 = peg$parseWS();
            while (s7 !== peg$FAILED) {
              s6.push(s7);
              s7 = peg$parseWS();
            }
            if (s6 !== peg$FAILED) {
              if (input.charCodeAt(peg$currPos) === 46) {
                s7 = peg$c196;
                peg$currPos++;
              } else {
                s7 = peg$FAILED;
                if (peg$silentFails === 0) { peg$fail(peg$c197); }
              }
              if (s7 === peg$FAILED) {
                s7 = null;
              }
              if (s7 !== peg$FAILED) {
                s8 = [];
                s9 = peg$parseWS();
                while (s9 !== peg$FAILED) {
                  s8.push(s9);
                  s9 = peg$parseWS();
                }
                if (s8 !== peg$FAILED) {
                  s9 = peg$parseTriplesBlock();
                  if (s9 === peg$FAILED) {
                    s9 = null;
                  }
                  if (s9 !== peg$FAILED) {
                    s5 = [s5, s6, s7, s8, s9];
                    s4 = s5;
                  } else {
                    peg$currPos = s4;
                    s4 = peg$FAILED;
                  }
                } else {
                  peg$currPos = s4;
                  s4 = peg$FAILED;
                }
              } else {
                peg$currPos = s4;
                s4 = peg$FAILED;
              }
            } else {
              peg$currPos = s4;
              s4 = peg$FAILED;
            }
          } else {
            peg$currPos = s4;
            s4 = peg$FAILED;
          }
        }
        if (s3 !== peg$FAILED) {
          peg$savedPos = s0;
          s1 = peg$c202(s1, s3);
          s0 = s1;
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }

    return s0;
  }

  function peg$parseTriplesBlock() {
    var s0, s1, s2, s3, s4, s5;

    s0 = peg$currPos;
    s1 = peg$parseTriplesSameSubjectPath();
    if (s1 !== peg$FAILED) {
      s2 = peg$currPos;
      s3 = [];
      s4 = peg$parseWS();
      while (s4 !== peg$FAILED) {
        s3.push(s4);
        s4 = peg$parseWS();
      }
      if (s3 !== peg$FAILED) {
        if (input.charCodeAt(peg$currPos) === 46) {
          s4 = peg$c196;
          peg$currPos++;
        } else {
          s4 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c197); }
        }
        if (s4 !== peg$FAILED) {
          s5 = peg$parseTriplesBlock();
          if (s5 === peg$FAILED) {
            s5 = null;
          }
          if (s5 !== peg$FAILED) {
            s3 = [s3, s4, s5];
            s2 = s3;
          } else {
            peg$currPos = s2;
            s2 = peg$FAILED;
          }
        } else {
          peg$currPos = s2;
          s2 = peg$FAILED;
        }
      } else {
        peg$currPos = s2;
        s2 = peg$FAILED;
      }
      if (s2 === peg$FAILED) {
        s2 = null;
      }
      if (s2 !== peg$FAILED) {
        peg$savedPos = s0;
        s1 = peg$c203(s1, s2);
        s0 = s1;
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }

    return s0;
  }

  function peg$parseGraphPatternNotTriples() {
    var s0;

    s0 = peg$parseGroupOrUnionGraphPattern();
    if (s0 === peg$FAILED) {
      s0 = peg$parseOptionalGraphPattern();
      if (s0 === peg$FAILED) {
        s0 = peg$parseMinusGraphPattern();
        if (s0 === peg$FAILED) {
          s0 = peg$parseGraphGraphPattern();
          if (s0 === peg$FAILED) {
            s0 = peg$parseServiceGraphPattern();
            if (s0 === peg$FAILED) {
              s0 = peg$parseFilter();
              if (s0 === peg$FAILED) {
                s0 = peg$parseBind();
                if (s0 === peg$FAILED) {
                  s0 = peg$parseInlineData();
                  if (s0 === peg$FAILED) {
                    s0 = peg$parseFunctionCall();
                  }
                }
              }
            }
          }
        }
      }
    }

    return s0;
  }

  function peg$parseOptionalGraphPattern() {
    var s0, s1, s2, s3, s4;

    s0 = peg$currPos;
    s1 = [];
    s2 = peg$parseWS();
    while (s2 !== peg$FAILED) {
      s1.push(s2);
      s2 = peg$parseWS();
    }
    if (s1 !== peg$FAILED) {
      if (input.substr(peg$currPos, 8) === peg$c204) {
        s2 = peg$c204;
        peg$currPos += 8;
      } else {
        s2 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c205); }
      }
      if (s2 === peg$FAILED) {
        if (input.substr(peg$currPos, 8) === peg$c206) {
          s2 = peg$c206;
          peg$currPos += 8;
        } else {
          s2 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c207); }
        }
      }
      if (s2 !== peg$FAILED) {
        s3 = [];
        s4 = peg$parseWS();
        while (s4 !== peg$FAILED) {
          s3.push(s4);
          s4 = peg$parseWS();
        }
        if (s3 !== peg$FAILED) {
          s4 = peg$parseGroupGraphPattern();
          if (s4 !== peg$FAILED) {
            peg$savedPos = s0;
            s1 = peg$c208(s4);
            s0 = s1;
          } else {
            peg$currPos = s0;
            s0 = peg$FAILED;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }

    return s0;
  }

  function peg$parseGraphGraphPattern() {
    var s0, s1, s2, s3, s4, s5, s6;

    s0 = peg$currPos;
    s1 = [];
    s2 = peg$parseWS();
    while (s2 !== peg$FAILED) {
      s1.push(s2);
      s2 = peg$parseWS();
    }
    if (s1 !== peg$FAILED) {
      if (input.substr(peg$currPos, 5) === peg$c179) {
        s2 = peg$c179;
        peg$currPos += 5;
      } else {
        s2 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c180); }
      }
      if (s2 === peg$FAILED) {
        if (input.substr(peg$currPos, 5) === peg$c181) {
          s2 = peg$c181;
          peg$currPos += 5;
        } else {
          s2 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c182); }
        }
      }
      if (s2 !== peg$FAILED) {
        s3 = [];
        s4 = peg$parseWS();
        while (s4 !== peg$FAILED) {
          s3.push(s4);
          s4 = peg$parseWS();
        }
        if (s3 !== peg$FAILED) {
          s4 = peg$parseVarOrIRIref();
          if (s4 !== peg$FAILED) {
            s5 = [];
            s6 = peg$parseWS();
            while (s6 !== peg$FAILED) {
              s5.push(s6);
              s6 = peg$parseWS();
            }
            if (s5 !== peg$FAILED) {
              s6 = peg$parseGroupGraphPattern();
              if (s6 !== peg$FAILED) {
                peg$savedPos = s0;
                s1 = peg$c209(s4, s6);
                s0 = s1;
              } else {
                peg$currPos = s0;
                s0 = peg$FAILED;
              }
            } else {
              peg$currPos = s0;
              s0 = peg$FAILED;
            }
          } else {
            peg$currPos = s0;
            s0 = peg$FAILED;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }

    return s0;
  }

  function peg$parseServiceGraphPattern() {
    var s0, s1, s2, s3;

    s0 = peg$currPos;
    if (input.substr(peg$currPos, 7) === peg$c210) {
      s1 = peg$c210;
      peg$currPos += 7;
    } else {
      s1 = peg$FAILED;
      if (peg$silentFails === 0) { peg$fail(peg$c211); }
    }
    if (s1 !== peg$FAILED) {
      s2 = peg$parseVarOrIRIref();
      if (s2 !== peg$FAILED) {
        s3 = peg$parseGroupGraphPattern();
        if (s3 !== peg$FAILED) {
          peg$savedPos = s0;
          s1 = peg$c212(s2, s3);
          s0 = s1;
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }

    return s0;
  }

  function peg$parseMinusGraphPattern() {
    var s0, s1, s2, s3;

    s0 = peg$currPos;
    if (input.substr(peg$currPos, 5) === peg$c213) {
      s1 = peg$c213;
      peg$currPos += 5;
    } else {
      s1 = peg$FAILED;
      if (peg$silentFails === 0) { peg$fail(peg$c214); }
    }
    if (s1 === peg$FAILED) {
      if (input.substr(peg$currPos, 5) === peg$c215) {
        s1 = peg$c215;
        peg$currPos += 5;
      } else {
        s1 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c216); }
      }
    }
    if (s1 !== peg$FAILED) {
      s2 = [];
      s3 = peg$parseWS();
      while (s3 !== peg$FAILED) {
        s2.push(s3);
        s3 = peg$parseWS();
      }
      if (s2 !== peg$FAILED) {
        s3 = peg$parseGroupGraphPattern();
        if (s3 !== peg$FAILED) {
          peg$savedPos = s0;
          s1 = peg$c217(s3);
          s0 = s1;
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }

    return s0;
  }

  function peg$parseGroupOrUnionGraphPattern() {
    var s0, s1, s2, s3, s4, s5, s6, s7;

    s0 = peg$currPos;
    s1 = peg$parseGroupGraphPattern();
    if (s1 !== peg$FAILED) {
      s2 = [];
      s3 = peg$currPos;
      s4 = [];
      s5 = peg$parseWS();
      while (s5 !== peg$FAILED) {
        s4.push(s5);
        s5 = peg$parseWS();
      }
      if (s4 !== peg$FAILED) {
        if (input.substr(peg$currPos, 5) === peg$c218) {
          s5 = peg$c218;
          peg$currPos += 5;
        } else {
          s5 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c219); }
        }
        if (s5 === peg$FAILED) {
          if (input.substr(peg$currPos, 5) === peg$c220) {
            s5 = peg$c220;
            peg$currPos += 5;
          } else {
            s5 = peg$FAILED;
            if (peg$silentFails === 0) { peg$fail(peg$c221); }
          }
        }
        if (s5 !== peg$FAILED) {
          s6 = [];
          s7 = peg$parseWS();
          while (s7 !== peg$FAILED) {
            s6.push(s7);
            s7 = peg$parseWS();
          }
          if (s6 !== peg$FAILED) {
            s7 = peg$parseGroupGraphPattern();
            if (s7 !== peg$FAILED) {
              s4 = [s4, s5, s6, s7];
              s3 = s4;
            } else {
              peg$currPos = s3;
              s3 = peg$FAILED;
            }
          } else {
            peg$currPos = s3;
            s3 = peg$FAILED;
          }
        } else {
          peg$currPos = s3;
          s3 = peg$FAILED;
        }
      } else {
        peg$currPos = s3;
        s3 = peg$FAILED;
      }
      while (s3 !== peg$FAILED) {
        s2.push(s3);
        s3 = peg$currPos;
        s4 = [];
        s5 = peg$parseWS();
        while (s5 !== peg$FAILED) {
          s4.push(s5);
          s5 = peg$parseWS();
        }
        if (s4 !== peg$FAILED) {
          if (input.substr(peg$currPos, 5) === peg$c218) {
            s5 = peg$c218;
            peg$currPos += 5;
          } else {
            s5 = peg$FAILED;
            if (peg$silentFails === 0) { peg$fail(peg$c219); }
          }
          if (s5 === peg$FAILED) {
            if (input.substr(peg$currPos, 5) === peg$c220) {
              s5 = peg$c220;
              peg$currPos += 5;
            } else {
              s5 = peg$FAILED;
              if (peg$silentFails === 0) { peg$fail(peg$c221); }
            }
          }
          if (s5 !== peg$FAILED) {
            s6 = [];
            s7 = peg$parseWS();
            while (s7 !== peg$FAILED) {
              s6.push(s7);
              s7 = peg$parseWS();
            }
            if (s6 !== peg$FAILED) {
              s7 = peg$parseGroupGraphPattern();
              if (s7 !== peg$FAILED) {
                s4 = [s4, s5, s6, s7];
                s3 = s4;
              } else {
                peg$currPos = s3;
                s3 = peg$FAILED;
              }
            } else {
              peg$currPos = s3;
              s3 = peg$FAILED;
            }
          } else {
            peg$currPos = s3;
            s3 = peg$FAILED;
          }
        } else {
          peg$currPos = s3;
          s3 = peg$FAILED;
        }
      }
      if (s2 !== peg$FAILED) {
        peg$savedPos = s0;
        s1 = peg$c222(s1, s2);
        s0 = s1;
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }

    return s0;
  }

  function peg$parseFilter() {
    var s0, s1, s2, s3, s4;

    s0 = peg$currPos;
    s1 = [];
    s2 = peg$parseWS();
    while (s2 !== peg$FAILED) {
      s1.push(s2);
      s2 = peg$parseWS();
    }
    if (s1 !== peg$FAILED) {
      if (input.substr(peg$currPos, 6) === peg$c223) {
        s2 = peg$c223;
        peg$currPos += 6;
      } else {
        s2 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c224); }
      }
      if (s2 === peg$FAILED) {
        if (input.substr(peg$currPos, 6) === peg$c225) {
          s2 = peg$c225;
          peg$currPos += 6;
        } else {
          s2 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c226); }
        }
      }
      if (s2 !== peg$FAILED) {
        s3 = [];
        s4 = peg$parseWS();
        while (s4 !== peg$FAILED) {
          s3.push(s4);
          s4 = peg$parseWS();
        }
        if (s3 !== peg$FAILED) {
          s4 = peg$parseConstraint();
          if (s4 !== peg$FAILED) {
            peg$savedPos = s0;
            s1 = peg$c227(s4);
            s0 = s1;
          } else {
            peg$currPos = s0;
            s0 = peg$FAILED;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }

    return s0;
  }

  function peg$parseBind() {
    var s0, s1, s2, s3, s4, s5, s6, s7, s8, s9, s10, s11, s12;

    s0 = peg$currPos;
    s1 = [];
    s2 = peg$parseWS();
    while (s2 !== peg$FAILED) {
      s1.push(s2);
      s2 = peg$parseWS();
    }
    if (s1 !== peg$FAILED) {
      if (input.substr(peg$currPos, 4) === peg$c228) {
        s2 = peg$c228;
        peg$currPos += 4;
      } else {
        s2 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c229); }
      }
      if (s2 === peg$FAILED) {
        if (input.substr(peg$currPos, 4) === peg$c230) {
          s2 = peg$c230;
          peg$currPos += 4;
        } else {
          s2 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c231); }
        }
      }
      if (s2 !== peg$FAILED) {
        s3 = [];
        s4 = peg$parseWS();
        while (s4 !== peg$FAILED) {
          s3.push(s4);
          s4 = peg$parseWS();
        }
        if (s3 !== peg$FAILED) {
          if (input.charCodeAt(peg$currPos) === 40) {
            s4 = peg$c27;
            peg$currPos++;
          } else {
            s4 = peg$FAILED;
            if (peg$silentFails === 0) { peg$fail(peg$c28); }
          }
          if (s4 !== peg$FAILED) {
            s5 = [];
            s6 = peg$parseWS();
            while (s6 !== peg$FAILED) {
              s5.push(s6);
              s6 = peg$parseWS();
            }
            if (s5 !== peg$FAILED) {
              s6 = peg$parseConditionalOrExpression();
              if (s6 !== peg$FAILED) {
                s7 = [];
                s8 = peg$parseWS();
                while (s8 !== peg$FAILED) {
                  s7.push(s8);
                  s8 = peg$parseWS();
                }
                if (s7 !== peg$FAILED) {
                  if (input.substr(peg$currPos, 2) === peg$c31) {
                    s8 = peg$c31;
                    peg$currPos += 2;
                  } else {
                    s8 = peg$FAILED;
                    if (peg$silentFails === 0) { peg$fail(peg$c32); }
                  }
                  if (s8 === peg$FAILED) {
                    if (input.substr(peg$currPos, 2) === peg$c29) {
                      s8 = peg$c29;
                      peg$currPos += 2;
                    } else {
                      s8 = peg$FAILED;
                      if (peg$silentFails === 0) { peg$fail(peg$c30); }
                    }
                  }
                  if (s8 !== peg$FAILED) {
                    s9 = [];
                    s10 = peg$parseWS();
                    while (s10 !== peg$FAILED) {
                      s9.push(s10);
                      s10 = peg$parseWS();
                    }
                    if (s9 !== peg$FAILED) {
                      s10 = peg$parseVar();
                      if (s10 !== peg$FAILED) {
                        s11 = [];
                        s12 = peg$parseWS();
                        while (s12 !== peg$FAILED) {
                          s11.push(s12);
                          s12 = peg$parseWS();
                        }
                        if (s11 !== peg$FAILED) {
                          if (input.charCodeAt(peg$currPos) === 41) {
                            s12 = peg$c33;
                            peg$currPos++;
                          } else {
                            s12 = peg$FAILED;
                            if (peg$silentFails === 0) { peg$fail(peg$c34); }
                          }
                          if (s12 !== peg$FAILED) {
                            peg$savedPos = s0;
                            s1 = peg$c232(s6, s10);
                            s0 = s1;
                          } else {
                            peg$currPos = s0;
                            s0 = peg$FAILED;
                          }
                        } else {
                          peg$currPos = s0;
                          s0 = peg$FAILED;
                        }
                      } else {
                        peg$currPos = s0;
                        s0 = peg$FAILED;
                      }
                    } else {
                      peg$currPos = s0;
                      s0 = peg$FAILED;
                    }
                  } else {
                    peg$currPos = s0;
                    s0 = peg$FAILED;
                  }
                } else {
                  peg$currPos = s0;
                  s0 = peg$FAILED;
                }
              } else {
                peg$currPos = s0;
                s0 = peg$FAILED;
              }
            } else {
              peg$currPos = s0;
              s0 = peg$FAILED;
            }
          } else {
            peg$currPos = s0;
            s0 = peg$FAILED;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }

    return s0;
  }

  function peg$parseConstraint() {
    var s0;

    s0 = peg$parseBrackettedExpression();
    if (s0 === peg$FAILED) {
      s0 = peg$parseBuiltInCall();
      if (s0 === peg$FAILED) {
        s0 = peg$parseFunctionCall();
      }
    }

    return s0;
  }

  function peg$parseInlineData() {
    var s0, s1, s2, s3, s4;

    s0 = peg$currPos;
    s1 = [];
    s2 = peg$parseWS();
    while (s2 !== peg$FAILED) {
      s1.push(s2);
      s2 = peg$parseWS();
    }
    if (s1 !== peg$FAILED) {
      if (input.substr(peg$currPos, 6) === peg$c117) {
        s2 = peg$c117;
        peg$currPos += 6;
      } else {
        s2 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c118); }
      }
      if (s2 === peg$FAILED) {
        if (input.substr(peg$currPos, 6) === peg$c119) {
          s2 = peg$c119;
          peg$currPos += 6;
        } else {
          s2 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c120); }
        }
      }
      if (s2 !== peg$FAILED) {
        s3 = [];
        s4 = peg$parseWS();
        while (s4 !== peg$FAILED) {
          s3.push(s4);
          s4 = peg$parseWS();
        }
        if (s3 !== peg$FAILED) {
          s4 = peg$parseDataBlock();
          if (s4 !== peg$FAILED) {
            peg$savedPos = s0;
            s1 = peg$c233(s4);
            s0 = s1;
          } else {
            peg$currPos = s0;
            s0 = peg$FAILED;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }

    return s0;
  }

  function peg$parseDataBlock() {
    var s0;

    s0 = peg$parseInlineDataOneVar();
    if (s0 === peg$FAILED) {
      s0 = peg$parseInlineDataFull();
    }

    return s0;
  }

  function peg$parseInlineDataOneVar() {
    var s0, s1, s2, s3, s4, s5, s6, s7;

    s0 = peg$currPos;
    s1 = [];
    s2 = peg$parseWS();
    while (s2 !== peg$FAILED) {
      s1.push(s2);
      s2 = peg$parseWS();
    }
    if (s1 !== peg$FAILED) {
      s2 = peg$parseVar();
      if (s2 !== peg$FAILED) {
        s3 = [];
        s4 = peg$parseWS();
        while (s4 !== peg$FAILED) {
          s3.push(s4);
          s4 = peg$parseWS();
        }
        if (s3 !== peg$FAILED) {
          if (input.charCodeAt(peg$currPos) === 123) {
            s4 = peg$c47;
            peg$currPos++;
          } else {
            s4 = peg$FAILED;
            if (peg$silentFails === 0) { peg$fail(peg$c48); }
          }
          if (s4 !== peg$FAILED) {
            s5 = [];
            s6 = peg$parseWS();
            while (s6 !== peg$FAILED) {
              s5.push(s6);
              s6 = peg$parseWS();
            }
            if (s5 !== peg$FAILED) {
              s6 = [];
              s7 = peg$parseDataBlockValue();
              while (s7 !== peg$FAILED) {
                s6.push(s7);
                s7 = peg$parseDataBlockValue();
              }
              if (s6 !== peg$FAILED) {
                if (input.charCodeAt(peg$currPos) === 125) {
                  s7 = peg$c49;
                  peg$currPos++;
                } else {
                  s7 = peg$FAILED;
                  if (peg$silentFails === 0) { peg$fail(peg$c50); }
                }
                if (s7 !== peg$FAILED) {
                  peg$savedPos = s0;
                  s1 = peg$c234(s2, s6);
                  s0 = s1;
                } else {
                  peg$currPos = s0;
                  s0 = peg$FAILED;
                }
              } else {
                peg$currPos = s0;
                s0 = peg$FAILED;
              }
            } else {
              peg$currPos = s0;
              s0 = peg$FAILED;
            }
          } else {
            peg$currPos = s0;
            s0 = peg$FAILED;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }

    return s0;
  }

  function peg$parseInlineDataFull() {
    var s0, s1, s2, s3, s4, s5, s6, s7, s8, s9, s10, s11, s12;

    s0 = peg$currPos;
    s1 = [];
    s2 = peg$parseWS();
    while (s2 !== peg$FAILED) {
      s1.push(s2);
      s2 = peg$parseWS();
    }
    if (s1 !== peg$FAILED) {
      if (input.charCodeAt(peg$currPos) === 40) {
        s2 = peg$c27;
        peg$currPos++;
      } else {
        s2 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c28); }
      }
      if (s2 !== peg$FAILED) {
        s3 = [];
        s4 = peg$parseWS();
        while (s4 !== peg$FAILED) {
          s3.push(s4);
          s4 = peg$parseWS();
        }
        if (s3 !== peg$FAILED) {
          s4 = [];
          s5 = peg$parseVar();
          while (s5 !== peg$FAILED) {
            s4.push(s5);
            s5 = peg$parseVar();
          }
          if (s4 !== peg$FAILED) {
            s5 = [];
            s6 = peg$parseWS();
            while (s6 !== peg$FAILED) {
              s5.push(s6);
              s6 = peg$parseWS();
            }
            if (s5 !== peg$FAILED) {
              if (input.charCodeAt(peg$currPos) === 41) {
                s6 = peg$c33;
                peg$currPos++;
              } else {
                s6 = peg$FAILED;
                if (peg$silentFails === 0) { peg$fail(peg$c34); }
              }
              if (s6 !== peg$FAILED) {
                s7 = [];
                s8 = peg$parseWS();
                while (s8 !== peg$FAILED) {
                  s7.push(s8);
                  s8 = peg$parseWS();
                }
                if (s7 !== peg$FAILED) {
                  if (input.charCodeAt(peg$currPos) === 123) {
                    s8 = peg$c47;
                    peg$currPos++;
                  } else {
                    s8 = peg$FAILED;
                    if (peg$silentFails === 0) { peg$fail(peg$c48); }
                  }
                  if (s8 !== peg$FAILED) {
                    s9 = [];
                    s10 = peg$parseWS();
                    while (s10 !== peg$FAILED) {
                      s9.push(s10);
                      s10 = peg$parseWS();
                    }
                    if (s9 !== peg$FAILED) {
                      s10 = [];
                      s11 = peg$parseDataBlockTuple();
                      while (s11 !== peg$FAILED) {
                        s10.push(s11);
                        s11 = peg$parseDataBlockTuple();
                      }
                      if (s10 !== peg$FAILED) {
                        s11 = [];
                        s12 = peg$parseWS();
                        while (s12 !== peg$FAILED) {
                          s11.push(s12);
                          s12 = peg$parseWS();
                        }
                        if (s11 !== peg$FAILED) {
                          if (input.charCodeAt(peg$currPos) === 125) {
                            s12 = peg$c49;
                            peg$currPos++;
                          } else {
                            s12 = peg$FAILED;
                            if (peg$silentFails === 0) { peg$fail(peg$c50); }
                          }
                          if (s12 !== peg$FAILED) {
                            peg$savedPos = s0;
                            s1 = peg$c235(s4, s10);
                            s0 = s1;
                          } else {
                            peg$currPos = s0;
                            s0 = peg$FAILED;
                          }
                        } else {
                          peg$currPos = s0;
                          s0 = peg$FAILED;
                        }
                      } else {
                        peg$currPos = s0;
                        s0 = peg$FAILED;
                      }
                    } else {
                      peg$currPos = s0;
                      s0 = peg$FAILED;
                    }
                  } else {
                    peg$currPos = s0;
                    s0 = peg$FAILED;
                  }
                } else {
                  peg$currPos = s0;
                  s0 = peg$FAILED;
                }
              } else {
                peg$currPos = s0;
                s0 = peg$FAILED;
              }
            } else {
              peg$currPos = s0;
              s0 = peg$FAILED;
            }
          } else {
            peg$currPos = s0;
            s0 = peg$FAILED;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }

    return s0;
  }

  function peg$parseDataBlockTuple() {
    var s0, s1, s2, s3, s4, s5, s6, s7;

    s0 = peg$currPos;
    if (input.charCodeAt(peg$currPos) === 40) {
      s1 = peg$c27;
      peg$currPos++;
    } else {
      s1 = peg$FAILED;
      if (peg$silentFails === 0) { peg$fail(peg$c28); }
    }
    if (s1 !== peg$FAILED) {
      s2 = [];
      s3 = peg$parseWS();
      while (s3 !== peg$FAILED) {
        s2.push(s3);
        s3 = peg$parseWS();
      }
      if (s2 !== peg$FAILED) {
        s3 = [];
        s4 = peg$parseDataBlockValue();
        while (s4 !== peg$FAILED) {
          s3.push(s4);
          s4 = peg$parseDataBlockValue();
        }
        if (s3 !== peg$FAILED) {
          s4 = [];
          s5 = peg$parseWS();
          while (s5 !== peg$FAILED) {
            s4.push(s5);
            s5 = peg$parseWS();
          }
          if (s4 !== peg$FAILED) {
            if (input.charCodeAt(peg$currPos) === 41) {
              s5 = peg$c33;
              peg$currPos++;
            } else {
              s5 = peg$FAILED;
              if (peg$silentFails === 0) { peg$fail(peg$c34); }
            }
            if (s5 !== peg$FAILED) {
              s6 = [];
              s7 = peg$parseWS();
              while (s7 !== peg$FAILED) {
                s6.push(s7);
                s7 = peg$parseWS();
              }
              if (s6 !== peg$FAILED) {
                peg$savedPos = s0;
                s1 = peg$c236(s3);
                s0 = s1;
              } else {
                peg$currPos = s0;
                s0 = peg$FAILED;
              }
            } else {
              peg$currPos = s0;
              s0 = peg$FAILED;
            }
          } else {
            peg$currPos = s0;
            s0 = peg$FAILED;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }

    return s0;
  }

  function peg$parseDataBlockValue() {
    var s0, s1, s2, s3, s4;

    s0 = peg$currPos;
    s1 = [];
    s2 = peg$parseWS();
    while (s2 !== peg$FAILED) {
      s1.push(s2);
      s2 = peg$parseWS();
    }
    if (s1 !== peg$FAILED) {
      s2 = peg$parseIRIref();
      if (s2 === peg$FAILED) {
        s2 = peg$parseRDFLiteral();
        if (s2 === peg$FAILED) {
          s2 = peg$parseNumericLiteral();
          if (s2 === peg$FAILED) {
            s2 = peg$parseBooleanLiteral();
            if (s2 === peg$FAILED) {
              if (input.substr(peg$currPos, 5) === peg$c115) {
                s2 = peg$c115;
                peg$currPos += 5;
              } else {
                s2 = peg$FAILED;
                if (peg$silentFails === 0) { peg$fail(peg$c116); }
              }
            }
          }
        }
      }
      if (s2 !== peg$FAILED) {
        s3 = [];
        s4 = peg$parseWS();
        while (s4 !== peg$FAILED) {
          s3.push(s4);
          s4 = peg$parseWS();
        }
        if (s3 !== peg$FAILED) {
          peg$savedPos = s0;
          s1 = peg$c84(s2);
          s0 = s1;
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }

    return s0;
  }

  function peg$parseFunctionCall() {
    var s0, s1, s2, s3;

    s0 = peg$currPos;
    s1 = peg$parseIRIref();
    if (s1 !== peg$FAILED) {
      s2 = [];
      s3 = peg$parseWS();
      while (s3 !== peg$FAILED) {
        s2.push(s3);
        s3 = peg$parseWS();
      }
      if (s2 !== peg$FAILED) {
        s3 = peg$parseArgList();
        if (s3 !== peg$FAILED) {
          peg$savedPos = s0;
          s1 = peg$c237(s1, s3);
          s0 = s1;
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }

    return s0;
  }

  function peg$parseArgList() {
    var s0, s1, s2, s3, s4, s5, s6, s7, s8, s9, s10, s11;

    s0 = peg$currPos;
    s1 = peg$parseNIL();
    if (s1 !== peg$FAILED) {
      peg$savedPos = s0;
      s1 = peg$c238();
    }
    s0 = s1;
    if (s0 === peg$FAILED) {
      s0 = peg$currPos;
      if (input.charCodeAt(peg$currPos) === 40) {
        s1 = peg$c27;
        peg$currPos++;
      } else {
        s1 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c28); }
      }
      if (s1 !== peg$FAILED) {
        s2 = [];
        s3 = peg$parseWS();
        while (s3 !== peg$FAILED) {
          s2.push(s3);
          s3 = peg$parseWS();
        }
        if (s2 !== peg$FAILED) {
          if (input.substr(peg$currPos, 8) === peg$c19) {
            s3 = peg$c19;
            peg$currPos += 8;
          } else {
            s3 = peg$FAILED;
            if (peg$silentFails === 0) { peg$fail(peg$c20); }
          }
          if (s3 === peg$FAILED) {
            if (input.substr(peg$currPos, 8) === peg$c21) {
              s3 = peg$c21;
              peg$currPos += 8;
            } else {
              s3 = peg$FAILED;
              if (peg$silentFails === 0) { peg$fail(peg$c22); }
            }
          }
          if (s3 === peg$FAILED) {
            s3 = null;
          }
          if (s3 !== peg$FAILED) {
            s4 = [];
            s5 = peg$parseWS();
            while (s5 !== peg$FAILED) {
              s4.push(s5);
              s5 = peg$parseWS();
            }
            if (s4 !== peg$FAILED) {
              s5 = peg$parseConditionalOrExpression();
              if (s5 !== peg$FAILED) {
                s6 = [];
                s7 = peg$parseWS();
                while (s7 !== peg$FAILED) {
                  s6.push(s7);
                  s7 = peg$parseWS();
                }
                if (s6 !== peg$FAILED) {
                  s7 = [];
                  s8 = peg$currPos;
                  if (input.charCodeAt(peg$currPos) === 44) {
                    s9 = peg$c239;
                    peg$currPos++;
                  } else {
                    s9 = peg$FAILED;
                    if (peg$silentFails === 0) { peg$fail(peg$c240); }
                  }
                  if (s9 !== peg$FAILED) {
                    s10 = [];
                    s11 = peg$parseWS();
                    while (s11 !== peg$FAILED) {
                      s10.push(s11);
                      s11 = peg$parseWS();
                    }
                    if (s10 !== peg$FAILED) {
                      s11 = peg$parseConditionalOrExpression();
                      if (s11 !== peg$FAILED) {
                        s9 = [s9, s10, s11];
                        s8 = s9;
                      } else {
                        peg$currPos = s8;
                        s8 = peg$FAILED;
                      }
                    } else {
                      peg$currPos = s8;
                      s8 = peg$FAILED;
                    }
                  } else {
                    peg$currPos = s8;
                    s8 = peg$FAILED;
                  }
                  while (s8 !== peg$FAILED) {
                    s7.push(s8);
                    s8 = peg$currPos;
                    if (input.charCodeAt(peg$currPos) === 44) {
                      s9 = peg$c239;
                      peg$currPos++;
                    } else {
                      s9 = peg$FAILED;
                      if (peg$silentFails === 0) { peg$fail(peg$c240); }
                    }
                    if (s9 !== peg$FAILED) {
                      s10 = [];
                      s11 = peg$parseWS();
                      while (s11 !== peg$FAILED) {
                        s10.push(s11);
                        s11 = peg$parseWS();
                      }
                      if (s10 !== peg$FAILED) {
                        s11 = peg$parseConditionalOrExpression();
                        if (s11 !== peg$FAILED) {
                          s9 = [s9, s10, s11];
                          s8 = s9;
                        } else {
                          peg$currPos = s8;
                          s8 = peg$FAILED;
                        }
                      } else {
                        peg$currPos = s8;
                        s8 = peg$FAILED;
                      }
                    } else {
                      peg$currPos = s8;
                      s8 = peg$FAILED;
                    }
                  }
                  if (s7 !== peg$FAILED) {
                    if (input.charCodeAt(peg$currPos) === 41) {
                      s8 = peg$c33;
                      peg$currPos++;
                    } else {
                      s8 = peg$FAILED;
                      if (peg$silentFails === 0) { peg$fail(peg$c34); }
                    }
                    if (s8 !== peg$FAILED) {
                      peg$savedPos = s0;
                      s1 = peg$c241(s3, s5, s7);
                      s0 = s1;
                    } else {
                      peg$currPos = s0;
                      s0 = peg$FAILED;
                    }
                  } else {
                    peg$currPos = s0;
                    s0 = peg$FAILED;
                  }
                } else {
                  peg$currPos = s0;
                  s0 = peg$FAILED;
                }
              } else {
                peg$currPos = s0;
                s0 = peg$FAILED;
              }
            } else {
              peg$currPos = s0;
              s0 = peg$FAILED;
            }
          } else {
            peg$currPos = s0;
            s0 = peg$FAILED;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    }

    return s0;
  }

  function peg$parseExpressionList() {
    var s0, s1, s2, s3, s4, s5, s6, s7, s8, s9;

    s0 = peg$currPos;
    s1 = peg$parseNIL();
    if (s1 !== peg$FAILED) {
      peg$savedPos = s0;
      s1 = peg$c238();
    }
    s0 = s1;
    if (s0 === peg$FAILED) {
      s0 = peg$currPos;
      if (input.charCodeAt(peg$currPos) === 40) {
        s1 = peg$c27;
        peg$currPos++;
      } else {
        s1 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c28); }
      }
      if (s1 !== peg$FAILED) {
        s2 = [];
        s3 = peg$parseWS();
        while (s3 !== peg$FAILED) {
          s2.push(s3);
          s3 = peg$parseWS();
        }
        if (s2 !== peg$FAILED) {
          s3 = peg$parseIRIref();
          if (s3 === peg$FAILED) {
            s3 = peg$parseConditionalOrExpression();
          }
          if (s3 !== peg$FAILED) {
            s4 = [];
            s5 = peg$parseWS();
            while (s5 !== peg$FAILED) {
              s4.push(s5);
              s5 = peg$parseWS();
            }
            if (s4 !== peg$FAILED) {
              s5 = [];
              s6 = peg$currPos;
              if (input.charCodeAt(peg$currPos) === 44) {
                s7 = peg$c239;
                peg$currPos++;
              } else {
                s7 = peg$FAILED;
                if (peg$silentFails === 0) { peg$fail(peg$c240); }
              }
              if (s7 !== peg$FAILED) {
                s8 = [];
                s9 = peg$parseWS();
                while (s9 !== peg$FAILED) {
                  s8.push(s9);
                  s9 = peg$parseWS();
                }
                if (s8 !== peg$FAILED) {
                  s9 = peg$parseIRIref();
                  if (s9 === peg$FAILED) {
                    s9 = peg$parseConditionalOrExpression();
                  }
                  if (s9 !== peg$FAILED) {
                    s7 = [s7, s8, s9];
                    s6 = s7;
                  } else {
                    peg$currPos = s6;
                    s6 = peg$FAILED;
                  }
                } else {
                  peg$currPos = s6;
                  s6 = peg$FAILED;
                }
              } else {
                peg$currPos = s6;
                s6 = peg$FAILED;
              }
              while (s6 !== peg$FAILED) {
                s5.push(s6);
                s6 = peg$currPos;
                if (input.charCodeAt(peg$currPos) === 44) {
                  s7 = peg$c239;
                  peg$currPos++;
                } else {
                  s7 = peg$FAILED;
                  if (peg$silentFails === 0) { peg$fail(peg$c240); }
                }
                if (s7 !== peg$FAILED) {
                  s8 = [];
                  s9 = peg$parseWS();
                  while (s9 !== peg$FAILED) {
                    s8.push(s9);
                    s9 = peg$parseWS();
                  }
                  if (s8 !== peg$FAILED) {
                    s9 = peg$parseIRIref();
                    if (s9 === peg$FAILED) {
                      s9 = peg$parseConditionalOrExpression();
                    }
                    if (s9 !== peg$FAILED) {
                      s7 = [s7, s8, s9];
                      s6 = s7;
                    } else {
                      peg$currPos = s6;
                      s6 = peg$FAILED;
                    }
                  } else {
                    peg$currPos = s6;
                    s6 = peg$FAILED;
                  }
                } else {
                  peg$currPos = s6;
                  s6 = peg$FAILED;
                }
              }
              if (s5 !== peg$FAILED) {
                if (input.charCodeAt(peg$currPos) === 41) {
                  s6 = peg$c33;
                  peg$currPos++;
                } else {
                  s6 = peg$FAILED;
                  if (peg$silentFails === 0) { peg$fail(peg$c34); }
                }
                if (s6 !== peg$FAILED) {
                  peg$savedPos = s0;
                  s1 = peg$c242(s3, s5);
                  s0 = s1;
                } else {
                  peg$currPos = s0;
                  s0 = peg$FAILED;
                }
              } else {
                peg$currPos = s0;
                s0 = peg$FAILED;
              }
            } else {
              peg$currPos = s0;
              s0 = peg$FAILED;
            }
          } else {
            peg$currPos = s0;
            s0 = peg$FAILED;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    }

    return s0;
  }

  function peg$parseConstructTemplate() {
    var s0, s1, s2, s3, s4, s5;

    s0 = peg$currPos;
    if (input.charCodeAt(peg$currPos) === 123) {
      s1 = peg$c47;
      peg$currPos++;
    } else {
      s1 = peg$FAILED;
      if (peg$silentFails === 0) { peg$fail(peg$c48); }
    }
    if (s1 !== peg$FAILED) {
      s2 = [];
      s3 = peg$parseWS();
      while (s3 !== peg$FAILED) {
        s2.push(s3);
        s3 = peg$parseWS();
      }
      if (s2 !== peg$FAILED) {
        s3 = peg$parseConstructTriples();
        if (s3 === peg$FAILED) {
          s3 = null;
        }
        if (s3 !== peg$FAILED) {
          s4 = [];
          s5 = peg$parseWS();
          while (s5 !== peg$FAILED) {
            s4.push(s5);
            s5 = peg$parseWS();
          }
          if (s4 !== peg$FAILED) {
            if (input.charCodeAt(peg$currPos) === 125) {
              s5 = peg$c49;
              peg$currPos++;
            } else {
              s5 = peg$FAILED;
              if (peg$silentFails === 0) { peg$fail(peg$c50); }
            }
            if (s5 !== peg$FAILED) {
              peg$savedPos = s0;
              s1 = peg$c243(s3);
              s0 = s1;
            } else {
              peg$currPos = s0;
              s0 = peg$FAILED;
            }
          } else {
            peg$currPos = s0;
            s0 = peg$FAILED;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }

    return s0;
  }

  function peg$parseConstructTriples() {
    var s0, s1, s2, s3, s4, s5, s6;

    s0 = peg$currPos;
    s1 = peg$parseTriplesSameSubject();
    if (s1 !== peg$FAILED) {
      s2 = peg$currPos;
      s3 = [];
      s4 = peg$parseWS();
      while (s4 !== peg$FAILED) {
        s3.push(s4);
        s4 = peg$parseWS();
      }
      if (s3 !== peg$FAILED) {
        if (input.charCodeAt(peg$currPos) === 46) {
          s4 = peg$c196;
          peg$currPos++;
        } else {
          s4 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c197); }
        }
        if (s4 !== peg$FAILED) {
          s5 = [];
          s6 = peg$parseWS();
          while (s6 !== peg$FAILED) {
            s5.push(s6);
            s6 = peg$parseWS();
          }
          if (s5 !== peg$FAILED) {
            s6 = peg$parseConstructTriples();
            if (s6 === peg$FAILED) {
              s6 = null;
            }
            if (s6 !== peg$FAILED) {
              s3 = [s3, s4, s5, s6];
              s2 = s3;
            } else {
              peg$currPos = s2;
              s2 = peg$FAILED;
            }
          } else {
            peg$currPos = s2;
            s2 = peg$FAILED;
          }
        } else {
          peg$currPos = s2;
          s2 = peg$FAILED;
        }
      } else {
        peg$currPos = s2;
        s2 = peg$FAILED;
      }
      if (s2 === peg$FAILED) {
        s2 = null;
      }
      if (s2 !== peg$FAILED) {
        peg$savedPos = s0;
        s1 = peg$c244(s1, s2);
        s0 = s1;
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }

    return s0;
  }

  function peg$parseTriplesSameSubject() {
    var s0, s1, s2, s3, s4;

    s0 = peg$currPos;
    s1 = [];
    s2 = peg$parseWS();
    while (s2 !== peg$FAILED) {
      s1.push(s2);
      s2 = peg$parseWS();
    }
    if (s1 !== peg$FAILED) {
      s2 = peg$parseVarOrTerm();
      if (s2 !== peg$FAILED) {
        s3 = [];
        s4 = peg$parseWS();
        while (s4 !== peg$FAILED) {
          s3.push(s4);
          s4 = peg$parseWS();
        }
        if (s3 !== peg$FAILED) {
          s4 = peg$parsePropertyListNotEmpty();
          if (s4 !== peg$FAILED) {
            peg$savedPos = s0;
            s1 = peg$c245(s2, s4);
            s0 = s1;
          } else {
            peg$currPos = s0;
            s0 = peg$FAILED;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }
    if (s0 === peg$FAILED) {
      s0 = peg$currPos;
      s1 = [];
      s2 = peg$parseWS();
      while (s2 !== peg$FAILED) {
        s1.push(s2);
        s2 = peg$parseWS();
      }
      if (s1 !== peg$FAILED) {
        s2 = peg$parseTriplesNode();
        if (s2 !== peg$FAILED) {
          s3 = [];
          s4 = peg$parseWS();
          while (s4 !== peg$FAILED) {
            s3.push(s4);
            s4 = peg$parseWS();
          }
          if (s3 !== peg$FAILED) {
            s4 = peg$parsePropertyList();
            if (s4 !== peg$FAILED) {
              peg$savedPos = s0;
              s1 = peg$c246(s2, s4);
              s0 = s1;
            } else {
              peg$currPos = s0;
              s0 = peg$FAILED;
            }
          } else {
            peg$currPos = s0;
            s0 = peg$FAILED;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    }

    return s0;
  }

  function peg$parsePropertyListPathNotEmpty() {
    var s0, s1, s2, s3, s4, s5, s6, s7, s8, s9, s10, s11, s12;

    s0 = peg$currPos;
    s1 = peg$parseVerbPath();
    if (s1 === peg$FAILED) {
      s1 = peg$parseVar();
    }
    if (s1 !== peg$FAILED) {
      s2 = [];
      s3 = peg$parseWS();
      while (s3 !== peg$FAILED) {
        s2.push(s3);
        s3 = peg$parseWS();
      }
      if (s2 !== peg$FAILED) {
        s3 = peg$parseObjectListPath();
        if (s3 !== peg$FAILED) {
          s4 = [];
          s5 = peg$currPos;
          s6 = [];
          s7 = peg$parseWS();
          while (s7 !== peg$FAILED) {
            s6.push(s7);
            s7 = peg$parseWS();
          }
          if (s6 !== peg$FAILED) {
            if (input.charCodeAt(peg$currPos) === 59) {
              s7 = peg$c122;
              peg$currPos++;
            } else {
              s7 = peg$FAILED;
              if (peg$silentFails === 0) { peg$fail(peg$c123); }
            }
            if (s7 !== peg$FAILED) {
              s8 = [];
              s9 = peg$parseWS();
              while (s9 !== peg$FAILED) {
                s8.push(s9);
                s9 = peg$parseWS();
              }
              if (s8 !== peg$FAILED) {
                s9 = peg$currPos;
                s10 = peg$parseVerbPath();
                if (s10 === peg$FAILED) {
                  s10 = peg$parseVar();
                }
                if (s10 !== peg$FAILED) {
                  s11 = [];
                  s12 = peg$parseWS();
                  while (s12 !== peg$FAILED) {
                    s11.push(s12);
                    s12 = peg$parseWS();
                  }
                  if (s11 !== peg$FAILED) {
                    s12 = peg$parseObjectList();
                    if (s12 !== peg$FAILED) {
                      s10 = [s10, s11, s12];
                      s9 = s10;
                    } else {
                      peg$currPos = s9;
                      s9 = peg$FAILED;
                    }
                  } else {
                    peg$currPos = s9;
                    s9 = peg$FAILED;
                  }
                } else {
                  peg$currPos = s9;
                  s9 = peg$FAILED;
                }
                if (s9 === peg$FAILED) {
                  s9 = null;
                }
                if (s9 !== peg$FAILED) {
                  s6 = [s6, s7, s8, s9];
                  s5 = s6;
                } else {
                  peg$currPos = s5;
                  s5 = peg$FAILED;
                }
              } else {
                peg$currPos = s5;
                s5 = peg$FAILED;
              }
            } else {
              peg$currPos = s5;
              s5 = peg$FAILED;
            }
          } else {
            peg$currPos = s5;
            s5 = peg$FAILED;
          }
          while (s5 !== peg$FAILED) {
            s4.push(s5);
            s5 = peg$currPos;
            s6 = [];
            s7 = peg$parseWS();
            while (s7 !== peg$FAILED) {
              s6.push(s7);
              s7 = peg$parseWS();
            }
            if (s6 !== peg$FAILED) {
              if (input.charCodeAt(peg$currPos) === 59) {
                s7 = peg$c122;
                peg$currPos++;
              } else {
                s7 = peg$FAILED;
                if (peg$silentFails === 0) { peg$fail(peg$c123); }
              }
              if (s7 !== peg$FAILED) {
                s8 = [];
                s9 = peg$parseWS();
                while (s9 !== peg$FAILED) {
                  s8.push(s9);
                  s9 = peg$parseWS();
                }
                if (s8 !== peg$FAILED) {
                  s9 = peg$currPos;
                  s10 = peg$parseVerbPath();
                  if (s10 === peg$FAILED) {
                    s10 = peg$parseVar();
                  }
                  if (s10 !== peg$FAILED) {
                    s11 = [];
                    s12 = peg$parseWS();
                    while (s12 !== peg$FAILED) {
                      s11.push(s12);
                      s12 = peg$parseWS();
                    }
                    if (s11 !== peg$FAILED) {
                      s12 = peg$parseObjectList();
                      if (s12 !== peg$FAILED) {
                        s10 = [s10, s11, s12];
                        s9 = s10;
                      } else {
                        peg$currPos = s9;
                        s9 = peg$FAILED;
                      }
                    } else {
                      peg$currPos = s9;
                      s9 = peg$FAILED;
                    }
                  } else {
                    peg$currPos = s9;
                    s9 = peg$FAILED;
                  }
                  if (s9 === peg$FAILED) {
                    s9 = null;
                  }
                  if (s9 !== peg$FAILED) {
                    s6 = [s6, s7, s8, s9];
                    s5 = s6;
                  } else {
                    peg$currPos = s5;
                    s5 = peg$FAILED;
                  }
                } else {
                  peg$currPos = s5;
                  s5 = peg$FAILED;
                }
              } else {
                peg$currPos = s5;
                s5 = peg$FAILED;
              }
            } else {
              peg$currPos = s5;
              s5 = peg$FAILED;
            }
          }
          if (s4 !== peg$FAILED) {
            peg$savedPos = s0;
            s1 = peg$c247(s1, s3, s4);
            s0 = s1;
          } else {
            peg$currPos = s0;
            s0 = peg$FAILED;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }

    return s0;
  }

  function peg$parsePropertyListNotEmpty() {
    var s0, s1, s2, s3, s4, s5, s6, s7, s8, s9, s10, s11, s12;

    s0 = peg$currPos;
    s1 = peg$parseVerb();
    if (s1 !== peg$FAILED) {
      s2 = [];
      s3 = peg$parseWS();
      while (s3 !== peg$FAILED) {
        s2.push(s3);
        s3 = peg$parseWS();
      }
      if (s2 !== peg$FAILED) {
        s3 = peg$parseObjectList();
        if (s3 !== peg$FAILED) {
          s4 = [];
          s5 = peg$currPos;
          s6 = [];
          s7 = peg$parseWS();
          while (s7 !== peg$FAILED) {
            s6.push(s7);
            s7 = peg$parseWS();
          }
          if (s6 !== peg$FAILED) {
            if (input.charCodeAt(peg$currPos) === 59) {
              s7 = peg$c122;
              peg$currPos++;
            } else {
              s7 = peg$FAILED;
              if (peg$silentFails === 0) { peg$fail(peg$c123); }
            }
            if (s7 !== peg$FAILED) {
              s8 = [];
              s9 = peg$parseWS();
              while (s9 !== peg$FAILED) {
                s8.push(s9);
                s9 = peg$parseWS();
              }
              if (s8 !== peg$FAILED) {
                s9 = peg$currPos;
                s10 = peg$parseVerb();
                if (s10 !== peg$FAILED) {
                  s11 = [];
                  s12 = peg$parseWS();
                  while (s12 !== peg$FAILED) {
                    s11.push(s12);
                    s12 = peg$parseWS();
                  }
                  if (s11 !== peg$FAILED) {
                    s12 = peg$parseObjectList();
                    if (s12 !== peg$FAILED) {
                      s10 = [s10, s11, s12];
                      s9 = s10;
                    } else {
                      peg$currPos = s9;
                      s9 = peg$FAILED;
                    }
                  } else {
                    peg$currPos = s9;
                    s9 = peg$FAILED;
                  }
                } else {
                  peg$currPos = s9;
                  s9 = peg$FAILED;
                }
                if (s9 === peg$FAILED) {
                  s9 = null;
                }
                if (s9 !== peg$FAILED) {
                  s6 = [s6, s7, s8, s9];
                  s5 = s6;
                } else {
                  peg$currPos = s5;
                  s5 = peg$FAILED;
                }
              } else {
                peg$currPos = s5;
                s5 = peg$FAILED;
              }
            } else {
              peg$currPos = s5;
              s5 = peg$FAILED;
            }
          } else {
            peg$currPos = s5;
            s5 = peg$FAILED;
          }
          while (s5 !== peg$FAILED) {
            s4.push(s5);
            s5 = peg$currPos;
            s6 = [];
            s7 = peg$parseWS();
            while (s7 !== peg$FAILED) {
              s6.push(s7);
              s7 = peg$parseWS();
            }
            if (s6 !== peg$FAILED) {
              if (input.charCodeAt(peg$currPos) === 59) {
                s7 = peg$c122;
                peg$currPos++;
              } else {
                s7 = peg$FAILED;
                if (peg$silentFails === 0) { peg$fail(peg$c123); }
              }
              if (s7 !== peg$FAILED) {
                s8 = [];
                s9 = peg$parseWS();
                while (s9 !== peg$FAILED) {
                  s8.push(s9);
                  s9 = peg$parseWS();
                }
                if (s8 !== peg$FAILED) {
                  s9 = peg$currPos;
                  s10 = peg$parseVerb();
                  if (s10 !== peg$FAILED) {
                    s11 = [];
                    s12 = peg$parseWS();
                    while (s12 !== peg$FAILED) {
                      s11.push(s12);
                      s12 = peg$parseWS();
                    }
                    if (s11 !== peg$FAILED) {
                      s12 = peg$parseObjectList();
                      if (s12 !== peg$FAILED) {
                        s10 = [s10, s11, s12];
                        s9 = s10;
                      } else {
                        peg$currPos = s9;
                        s9 = peg$FAILED;
                      }
                    } else {
                      peg$currPos = s9;
                      s9 = peg$FAILED;
                    }
                  } else {
                    peg$currPos = s9;
                    s9 = peg$FAILED;
                  }
                  if (s9 === peg$FAILED) {
                    s9 = null;
                  }
                  if (s9 !== peg$FAILED) {
                    s6 = [s6, s7, s8, s9];
                    s5 = s6;
                  } else {
                    peg$currPos = s5;
                    s5 = peg$FAILED;
                  }
                } else {
                  peg$currPos = s5;
                  s5 = peg$FAILED;
                }
              } else {
                peg$currPos = s5;
                s5 = peg$FAILED;
              }
            } else {
              peg$currPos = s5;
              s5 = peg$FAILED;
            }
          }
          if (s4 !== peg$FAILED) {
            peg$savedPos = s0;
            s1 = peg$c247(s1, s3, s4);
            s0 = s1;
          } else {
            peg$currPos = s0;
            s0 = peg$FAILED;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }

    return s0;
  }

  function peg$parsePropertyList() {
    var s0;

    s0 = peg$parsePropertyListNotEmpty();
    if (s0 === peg$FAILED) {
      s0 = null;
    }

    return s0;
  }

  function peg$parseObjectListPath() {
    var s0, s1, s2, s3, s4, s5, s6, s7;

    s0 = peg$currPos;
    s1 = peg$parseGraphNodePath();
    if (s1 !== peg$FAILED) {
      s2 = [];
      s3 = peg$parseWS();
      while (s3 !== peg$FAILED) {
        s2.push(s3);
        s3 = peg$parseWS();
      }
      if (s2 !== peg$FAILED) {
        s3 = [];
        s4 = peg$currPos;
        if (input.charCodeAt(peg$currPos) === 44) {
          s5 = peg$c239;
          peg$currPos++;
        } else {
          s5 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c240); }
        }
        if (s5 !== peg$FAILED) {
          s6 = [];
          s7 = peg$parseWS();
          while (s7 !== peg$FAILED) {
            s6.push(s7);
            s7 = peg$parseWS();
          }
          if (s6 !== peg$FAILED) {
            s7 = peg$parseGraphNodePath();
            if (s7 !== peg$FAILED) {
              s5 = [s5, s6, s7];
              s4 = s5;
            } else {
              peg$currPos = s4;
              s4 = peg$FAILED;
            }
          } else {
            peg$currPos = s4;
            s4 = peg$FAILED;
          }
        } else {
          peg$currPos = s4;
          s4 = peg$FAILED;
        }
        while (s4 !== peg$FAILED) {
          s3.push(s4);
          s4 = peg$currPos;
          if (input.charCodeAt(peg$currPos) === 44) {
            s5 = peg$c239;
            peg$currPos++;
          } else {
            s5 = peg$FAILED;
            if (peg$silentFails === 0) { peg$fail(peg$c240); }
          }
          if (s5 !== peg$FAILED) {
            s6 = [];
            s7 = peg$parseWS();
            while (s7 !== peg$FAILED) {
              s6.push(s7);
              s7 = peg$parseWS();
            }
            if (s6 !== peg$FAILED) {
              s7 = peg$parseGraphNodePath();
              if (s7 !== peg$FAILED) {
                s5 = [s5, s6, s7];
                s4 = s5;
              } else {
                peg$currPos = s4;
                s4 = peg$FAILED;
              }
            } else {
              peg$currPos = s4;
              s4 = peg$FAILED;
            }
          } else {
            peg$currPos = s4;
            s4 = peg$FAILED;
          }
        }
        if (s3 !== peg$FAILED) {
          peg$savedPos = s0;
          s1 = peg$c248(s1, s3);
          s0 = s1;
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }

    return s0;
  }

  function peg$parseObjectList() {
    var s0, s1, s2, s3, s4, s5, s6, s7;

    s0 = peg$currPos;
    s1 = peg$parseGraphNode();
    if (s1 !== peg$FAILED) {
      s2 = [];
      s3 = peg$parseWS();
      while (s3 !== peg$FAILED) {
        s2.push(s3);
        s3 = peg$parseWS();
      }
      if (s2 !== peg$FAILED) {
        s3 = [];
        s4 = peg$currPos;
        if (input.charCodeAt(peg$currPos) === 44) {
          s5 = peg$c239;
          peg$currPos++;
        } else {
          s5 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c240); }
        }
        if (s5 !== peg$FAILED) {
          s6 = [];
          s7 = peg$parseWS();
          while (s7 !== peg$FAILED) {
            s6.push(s7);
            s7 = peg$parseWS();
          }
          if (s6 !== peg$FAILED) {
            s7 = peg$parseGraphNode();
            if (s7 !== peg$FAILED) {
              s5 = [s5, s6, s7];
              s4 = s5;
            } else {
              peg$currPos = s4;
              s4 = peg$FAILED;
            }
          } else {
            peg$currPos = s4;
            s4 = peg$FAILED;
          }
        } else {
          peg$currPos = s4;
          s4 = peg$FAILED;
        }
        while (s4 !== peg$FAILED) {
          s3.push(s4);
          s4 = peg$currPos;
          if (input.charCodeAt(peg$currPos) === 44) {
            s5 = peg$c239;
            peg$currPos++;
          } else {
            s5 = peg$FAILED;
            if (peg$silentFails === 0) { peg$fail(peg$c240); }
          }
          if (s5 !== peg$FAILED) {
            s6 = [];
            s7 = peg$parseWS();
            while (s7 !== peg$FAILED) {
              s6.push(s7);
              s7 = peg$parseWS();
            }
            if (s6 !== peg$FAILED) {
              s7 = peg$parseGraphNode();
              if (s7 !== peg$FAILED) {
                s5 = [s5, s6, s7];
                s4 = s5;
              } else {
                peg$currPos = s4;
                s4 = peg$FAILED;
              }
            } else {
              peg$currPos = s4;
              s4 = peg$FAILED;
            }
          } else {
            peg$currPos = s4;
            s4 = peg$FAILED;
          }
        }
        if (s3 !== peg$FAILED) {
          peg$savedPos = s0;
          s1 = peg$c248(s1, s3);
          s0 = s1;
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }

    return s0;
  }

  function peg$parseVerb() {
    var s0, s1;

    s0 = peg$parseVarOrIRIref();
    if (s0 === peg$FAILED) {
      s0 = peg$currPos;
      if (input.charCodeAt(peg$currPos) === 97) {
        s1 = peg$c249;
        peg$currPos++;
      } else {
        s1 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c250); }
      }
      if (s1 !== peg$FAILED) {
        peg$savedPos = s0;
        s1 = peg$c251();
      }
      s0 = s1;
    }

    return s0;
  }

  function peg$parseTriplesSameSubjectPath() {
    var s0, s1, s2, s3, s4;

    s0 = peg$currPos;
    s1 = [];
    s2 = peg$parseWS();
    while (s2 !== peg$FAILED) {
      s1.push(s2);
      s2 = peg$parseWS();
    }
    if (s1 !== peg$FAILED) {
      s2 = peg$parseVarOrTerm();
      if (s2 !== peg$FAILED) {
        s3 = [];
        s4 = peg$parseWS();
        while (s4 !== peg$FAILED) {
          s3.push(s4);
          s4 = peg$parseWS();
        }
        if (s3 !== peg$FAILED) {
          s4 = peg$parsePropertyListNotEmptyPath();
          if (s4 !== peg$FAILED) {
            peg$savedPos = s0;
            s1 = peg$c252(s2, s4);
            s0 = s1;
          } else {
            peg$currPos = s0;
            s0 = peg$FAILED;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }
    if (s0 === peg$FAILED) {
      s0 = peg$currPos;
      s1 = [];
      s2 = peg$parseWS();
      while (s2 !== peg$FAILED) {
        s1.push(s2);
        s2 = peg$parseWS();
      }
      if (s1 !== peg$FAILED) {
        s2 = peg$parseTriplesNodePath();
        if (s2 !== peg$FAILED) {
          s3 = [];
          s4 = peg$parseWS();
          while (s4 !== peg$FAILED) {
            s3.push(s4);
            s4 = peg$parseWS();
          }
          if (s3 !== peg$FAILED) {
            s4 = peg$parsePropertyListPath();
            if (s4 !== peg$FAILED) {
              peg$savedPos = s0;
              s1 = peg$c253(s2, s4);
              s0 = s1;
            } else {
              peg$currPos = s0;
              s0 = peg$FAILED;
            }
          } else {
            peg$currPos = s0;
            s0 = peg$FAILED;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    }

    return s0;
  }

  function peg$parsePropertyListNotEmptyPath() {
    var s0, s1, s2, s3, s4, s5, s6, s7, s8, s9, s10, s11;

    s0 = peg$currPos;
    s1 = peg$parseVerbPath();
    if (s1 === peg$FAILED) {
      s1 = peg$parseVar();
    }
    if (s1 !== peg$FAILED) {
      s2 = [];
      s3 = peg$parseWS();
      while (s3 !== peg$FAILED) {
        s2.push(s3);
        s3 = peg$parseWS();
      }
      if (s2 !== peg$FAILED) {
        s3 = peg$parseObjectListPath();
        if (s3 !== peg$FAILED) {
          s4 = [];
          s5 = peg$currPos;
          s6 = [];
          s7 = peg$parseWS();
          while (s7 !== peg$FAILED) {
            s6.push(s7);
            s7 = peg$parseWS();
          }
          if (s6 !== peg$FAILED) {
            if (input.charCodeAt(peg$currPos) === 59) {
              s7 = peg$c122;
              peg$currPos++;
            } else {
              s7 = peg$FAILED;
              if (peg$silentFails === 0) { peg$fail(peg$c123); }
            }
            if (s7 !== peg$FAILED) {
              s8 = [];
              s9 = peg$parseWS();
              while (s9 !== peg$FAILED) {
                s8.push(s9);
                s9 = peg$parseWS();
              }
              if (s8 !== peg$FAILED) {
                s9 = peg$currPos;
                s10 = peg$parseVerbPath();
                if (s10 === peg$FAILED) {
                  s10 = peg$parseVar();
                }
                if (s10 !== peg$FAILED) {
                  s11 = peg$parseObjectList();
                  if (s11 !== peg$FAILED) {
                    s10 = [s10, s11];
                    s9 = s10;
                  } else {
                    peg$currPos = s9;
                    s9 = peg$FAILED;
                  }
                } else {
                  peg$currPos = s9;
                  s9 = peg$FAILED;
                }
                if (s9 === peg$FAILED) {
                  s9 = null;
                }
                if (s9 !== peg$FAILED) {
                  s6 = [s6, s7, s8, s9];
                  s5 = s6;
                } else {
                  peg$currPos = s5;
                  s5 = peg$FAILED;
                }
              } else {
                peg$currPos = s5;
                s5 = peg$FAILED;
              }
            } else {
              peg$currPos = s5;
              s5 = peg$FAILED;
            }
          } else {
            peg$currPos = s5;
            s5 = peg$FAILED;
          }
          while (s5 !== peg$FAILED) {
            s4.push(s5);
            s5 = peg$currPos;
            s6 = [];
            s7 = peg$parseWS();
            while (s7 !== peg$FAILED) {
              s6.push(s7);
              s7 = peg$parseWS();
            }
            if (s6 !== peg$FAILED) {
              if (input.charCodeAt(peg$currPos) === 59) {
                s7 = peg$c122;
                peg$currPos++;
              } else {
                s7 = peg$FAILED;
                if (peg$silentFails === 0) { peg$fail(peg$c123); }
              }
              if (s7 !== peg$FAILED) {
                s8 = [];
                s9 = peg$parseWS();
                while (s9 !== peg$FAILED) {
                  s8.push(s9);
                  s9 = peg$parseWS();
                }
                if (s8 !== peg$FAILED) {
                  s9 = peg$currPos;
                  s10 = peg$parseVerbPath();
                  if (s10 === peg$FAILED) {
                    s10 = peg$parseVar();
                  }
                  if (s10 !== peg$FAILED) {
                    s11 = peg$parseObjectList();
                    if (s11 !== peg$FAILED) {
                      s10 = [s10, s11];
                      s9 = s10;
                    } else {
                      peg$currPos = s9;
                      s9 = peg$FAILED;
                    }
                  } else {
                    peg$currPos = s9;
                    s9 = peg$FAILED;
                  }
                  if (s9 === peg$FAILED) {
                    s9 = null;
                  }
                  if (s9 !== peg$FAILED) {
                    s6 = [s6, s7, s8, s9];
                    s5 = s6;
                  } else {
                    peg$currPos = s5;
                    s5 = peg$FAILED;
                  }
                } else {
                  peg$currPos = s5;
                  s5 = peg$FAILED;
                }
              } else {
                peg$currPos = s5;
                s5 = peg$FAILED;
              }
            } else {
              peg$currPos = s5;
              s5 = peg$FAILED;
            }
          }
          if (s4 !== peg$FAILED) {
            peg$savedPos = s0;
            s1 = peg$c254(s1, s3, s4);
            s0 = s1;
          } else {
            peg$currPos = s0;
            s0 = peg$FAILED;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }

    return s0;
  }

  function peg$parsePropertyListPath() {
    var s0;

    s0 = peg$parsePropertyListPathNotEmpty();
    if (s0 === peg$FAILED) {
      s0 = null;
    }

    return s0;
  }

  function peg$parseVerbPath() {
    var s0, s1;

    s0 = peg$currPos;
    s1 = peg$parsePathAlternative();
    if (s1 !== peg$FAILED) {
      peg$savedPos = s0;
      s1 = peg$c255(s1);
    }
    s0 = s1;

    return s0;
  }

  function peg$parsePathAlternative() {
    var s0, s1, s2, s3, s4, s5;

    s0 = peg$currPos;
    s1 = peg$parsePathSequence();
    if (s1 !== peg$FAILED) {
      s2 = [];
      s3 = peg$currPos;
      if (input.charCodeAt(peg$currPos) === 124) {
        s4 = peg$c256;
        peg$currPos++;
      } else {
        s4 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c257); }
      }
      if (s4 !== peg$FAILED) {
        s5 = peg$parsePathSequence();
        if (s5 !== peg$FAILED) {
          s4 = [s4, s5];
          s3 = s4;
        } else {
          peg$currPos = s3;
          s3 = peg$FAILED;
        }
      } else {
        peg$currPos = s3;
        s3 = peg$FAILED;
      }
      while (s3 !== peg$FAILED) {
        s2.push(s3);
        s3 = peg$currPos;
        if (input.charCodeAt(peg$currPos) === 124) {
          s4 = peg$c256;
          peg$currPos++;
        } else {
          s4 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c257); }
        }
        if (s4 !== peg$FAILED) {
          s5 = peg$parsePathSequence();
          if (s5 !== peg$FAILED) {
            s4 = [s4, s5];
            s3 = s4;
          } else {
            peg$currPos = s3;
            s3 = peg$FAILED;
          }
        } else {
          peg$currPos = s3;
          s3 = peg$FAILED;
        }
      }
      if (s2 !== peg$FAILED) {
        peg$savedPos = s0;
        s1 = peg$c258(s1, s2);
        s0 = s1;
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }

    return s0;
  }

  function peg$parsePathSequence() {
    var s0, s1, s2, s3, s4, s5;

    s0 = peg$currPos;
    s1 = peg$parsePathEltOrInverse();
    if (s1 !== peg$FAILED) {
      s2 = [];
      s3 = peg$currPos;
      if (input.charCodeAt(peg$currPos) === 47) {
        s4 = peg$c259;
        peg$currPos++;
      } else {
        s4 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c260); }
      }
      if (s4 !== peg$FAILED) {
        s5 = peg$parsePathEltOrInverse();
        if (s5 !== peg$FAILED) {
          s4 = [s4, s5];
          s3 = s4;
        } else {
          peg$currPos = s3;
          s3 = peg$FAILED;
        }
      } else {
        peg$currPos = s3;
        s3 = peg$FAILED;
      }
      while (s3 !== peg$FAILED) {
        s2.push(s3);
        s3 = peg$currPos;
        if (input.charCodeAt(peg$currPos) === 47) {
          s4 = peg$c259;
          peg$currPos++;
        } else {
          s4 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c260); }
        }
        if (s4 !== peg$FAILED) {
          s5 = peg$parsePathEltOrInverse();
          if (s5 !== peg$FAILED) {
            s4 = [s4, s5];
            s3 = s4;
          } else {
            peg$currPos = s3;
            s3 = peg$FAILED;
          }
        } else {
          peg$currPos = s3;
          s3 = peg$FAILED;
        }
      }
      if (s2 !== peg$FAILED) {
        peg$savedPos = s0;
        s1 = peg$c261(s1, s2);
        s0 = s1;
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }

    return s0;
  }

  function peg$parsePathElt() {
    var s0, s1, s2;

    s0 = peg$currPos;
    s1 = peg$parsePathPrimary();
    if (s1 !== peg$FAILED) {
      s2 = peg$parsePathMod();
      if (s2 === peg$FAILED) {
        s2 = null;
      }
      if (s2 !== peg$FAILED) {
        peg$savedPos = s0;
        s1 = peg$c262(s1, s2);
        s0 = s1;
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }

    return s0;
  }

  function peg$parsePathEltOrInverse() {
    var s0, s1, s2;

    s0 = peg$parsePathElt();
    if (s0 === peg$FAILED) {
      s0 = peg$currPos;
      if (input.charCodeAt(peg$currPos) === 94) {
        s1 = peg$c263;
        peg$currPos++;
      } else {
        s1 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c264); }
      }
      if (s1 !== peg$FAILED) {
        s2 = peg$parsePathElt();
        if (s2 !== peg$FAILED) {
          peg$savedPos = s0;
          s1 = peg$c265(s2);
          s0 = s1;
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    }

    return s0;
  }

  function peg$parsePathMod() {
    var s0, s1;

    s0 = peg$currPos;
    if (input.charCodeAt(peg$currPos) === 63) {
      s1 = peg$c266;
      peg$currPos++;
    } else {
      s1 = peg$FAILED;
      if (peg$silentFails === 0) { peg$fail(peg$c267); }
    }
    if (s1 === peg$FAILED) {
      if (input.charCodeAt(peg$currPos) === 42) {
        s1 = peg$c35;
        peg$currPos++;
      } else {
        s1 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c36); }
      }
      if (s1 === peg$FAILED) {
        if (input.charCodeAt(peg$currPos) === 43) {
          s1 = peg$c268;
          peg$currPos++;
        } else {
          s1 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c269); }
        }
      }
    }
    if (s1 !== peg$FAILED) {
      peg$savedPos = s0;
      s1 = peg$c270(s1);
    }
    s0 = s1;

    return s0;
  }

  function peg$parsePathPrimary() {
    var s0, s1, s2, s3;

    s0 = peg$parseIRIref();
    if (s0 === peg$FAILED) {
      s0 = peg$currPos;
      if (input.charCodeAt(peg$currPos) === 97) {
        s1 = peg$c249;
        peg$currPos++;
      } else {
        s1 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c250); }
      }
      if (s1 !== peg$FAILED) {
        peg$savedPos = s0;
        s1 = peg$c271();
      }
      s0 = s1;
      if (s0 === peg$FAILED) {
        s0 = peg$currPos;
        if (input.charCodeAt(peg$currPos) === 33) {
          s1 = peg$c272;
          peg$currPos++;
        } else {
          s1 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c273); }
        }
        if (s1 !== peg$FAILED) {
          s2 = peg$parsePathNegatedPropertySet();
          if (s2 !== peg$FAILED) {
            s1 = [s1, s2];
            s0 = s1;
          } else {
            peg$currPos = s0;
            s0 = peg$FAILED;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
        if (s0 === peg$FAILED) {
          s0 = peg$currPos;
          if (input.charCodeAt(peg$currPos) === 40) {
            s1 = peg$c27;
            peg$currPos++;
          } else {
            s1 = peg$FAILED;
            if (peg$silentFails === 0) { peg$fail(peg$c28); }
          }
          if (s1 !== peg$FAILED) {
            s2 = peg$parsePathAlternative();
            if (s2 !== peg$FAILED) {
              if (input.charCodeAt(peg$currPos) === 41) {
                s3 = peg$c33;
                peg$currPos++;
              } else {
                s3 = peg$FAILED;
                if (peg$silentFails === 0) { peg$fail(peg$c34); }
              }
              if (s3 !== peg$FAILED) {
                peg$savedPos = s0;
                s1 = peg$c201(s2);
                s0 = s1;
              } else {
                peg$currPos = s0;
                s0 = peg$FAILED;
              }
            } else {
              peg$currPos = s0;
              s0 = peg$FAILED;
            }
          } else {
            peg$currPos = s0;
            s0 = peg$FAILED;
          }
        }
      }
    }

    return s0;
  }

  function peg$parsePathNegatedPropertySet() {
    var s0, s1, s2, s3, s4, s5, s6, s7;

    s0 = peg$parsePathOneInPropertySet();
    if (s0 === peg$FAILED) {
      s0 = peg$currPos;
      if (input.charCodeAt(peg$currPos) === 40) {
        s1 = peg$c27;
        peg$currPos++;
      } else {
        s1 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c28); }
      }
      if (s1 !== peg$FAILED) {
        s2 = peg$currPos;
        s3 = peg$parsePathOneInPropertySet();
        if (s3 !== peg$FAILED) {
          s4 = [];
          s5 = peg$currPos;
          if (input.charCodeAt(peg$currPos) === 124) {
            s6 = peg$c256;
            peg$currPos++;
          } else {
            s6 = peg$FAILED;
            if (peg$silentFails === 0) { peg$fail(peg$c257); }
          }
          if (s6 !== peg$FAILED) {
            s7 = peg$parsePathOneInPropertySet();
            if (s7 !== peg$FAILED) {
              s6 = [s6, s7];
              s5 = s6;
            } else {
              peg$currPos = s5;
              s5 = peg$FAILED;
            }
          } else {
            peg$currPos = s5;
            s5 = peg$FAILED;
          }
          while (s5 !== peg$FAILED) {
            s4.push(s5);
            s5 = peg$currPos;
            if (input.charCodeAt(peg$currPos) === 124) {
              s6 = peg$c256;
              peg$currPos++;
            } else {
              s6 = peg$FAILED;
              if (peg$silentFails === 0) { peg$fail(peg$c257); }
            }
            if (s6 !== peg$FAILED) {
              s7 = peg$parsePathOneInPropertySet();
              if (s7 !== peg$FAILED) {
                s6 = [s6, s7];
                s5 = s6;
              } else {
                peg$currPos = s5;
                s5 = peg$FAILED;
              }
            } else {
              peg$currPos = s5;
              s5 = peg$FAILED;
            }
          }
          if (s4 !== peg$FAILED) {
            s3 = [s3, s4];
            s2 = s3;
          } else {
            peg$currPos = s2;
            s2 = peg$FAILED;
          }
        } else {
          peg$currPos = s2;
          s2 = peg$FAILED;
        }
        if (s2 === peg$FAILED) {
          s2 = null;
        }
        if (s2 !== peg$FAILED) {
          if (input.charCodeAt(peg$currPos) === 41) {
            s3 = peg$c33;
            peg$currPos++;
          } else {
            s3 = peg$FAILED;
            if (peg$silentFails === 0) { peg$fail(peg$c34); }
          }
          if (s3 !== peg$FAILED) {
            s1 = [s1, s2, s3];
            s0 = s1;
          } else {
            peg$currPos = s0;
            s0 = peg$FAILED;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    }

    return s0;
  }

  function peg$parsePathOneInPropertySet() {
    var s0, s1, s2;

    s0 = peg$parseIRIref();
    if (s0 === peg$FAILED) {
      if (input.charCodeAt(peg$currPos) === 97) {
        s0 = peg$c249;
        peg$currPos++;
      } else {
        s0 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c250); }
      }
      if (s0 === peg$FAILED) {
        s0 = peg$currPos;
        if (input.charCodeAt(peg$currPos) === 94) {
          s1 = peg$c263;
          peg$currPos++;
        } else {
          s1 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c264); }
        }
        if (s1 !== peg$FAILED) {
          s2 = peg$parseIRIref();
          if (s2 === peg$FAILED) {
            if (input.charCodeAt(peg$currPos) === 97) {
              s2 = peg$c249;
              peg$currPos++;
            } else {
              s2 = peg$FAILED;
              if (peg$silentFails === 0) { peg$fail(peg$c250); }
            }
          }
          if (s2 !== peg$FAILED) {
            s1 = [s1, s2];
            s0 = s1;
          } else {
            peg$currPos = s0;
            s0 = peg$FAILED;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      }
    }

    return s0;
  }

  function peg$parseTriplesNodePath() {
    var s0, s1;

    s0 = peg$currPos;
    s1 = peg$parseCollectionPath();
    if (s1 !== peg$FAILED) {
      peg$savedPos = s0;
      s1 = peg$c274(s1);
    }
    s0 = s1;
    if (s0 === peg$FAILED) {
      s0 = peg$parseBlankNodePropertyListPath();
    }

    return s0;
  }

  function peg$parseTriplesNode() {
    var s0, s1;

    s0 = peg$currPos;
    s1 = peg$parseCollection();
    if (s1 !== peg$FAILED) {
      peg$savedPos = s0;
      s1 = peg$c275(s1);
    }
    s0 = s1;
    if (s0 === peg$FAILED) {
      s0 = peg$parseBlankNodePropertyList();
    }

    return s0;
  }

  function peg$parseBlankNodePropertyList() {
    var s0, s1, s2, s3, s4, s5, s6, s7, s8;

    s0 = peg$currPos;
    s1 = [];
    s2 = peg$parseWS();
    while (s2 !== peg$FAILED) {
      s1.push(s2);
      s2 = peg$parseWS();
    }
    if (s1 !== peg$FAILED) {
      if (input.charCodeAt(peg$currPos) === 91) {
        s2 = peg$c276;
        peg$currPos++;
      } else {
        s2 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c277); }
      }
      if (s2 !== peg$FAILED) {
        s3 = [];
        s4 = peg$parseWS();
        while (s4 !== peg$FAILED) {
          s3.push(s4);
          s4 = peg$parseWS();
        }
        if (s3 !== peg$FAILED) {
          s4 = peg$parsePropertyListNotEmpty();
          if (s4 !== peg$FAILED) {
            s5 = [];
            s6 = peg$parseWS();
            while (s6 !== peg$FAILED) {
              s5.push(s6);
              s6 = peg$parseWS();
            }
            if (s5 !== peg$FAILED) {
              if (input.charCodeAt(peg$currPos) === 93) {
                s6 = peg$c278;
                peg$currPos++;
              } else {
                s6 = peg$FAILED;
                if (peg$silentFails === 0) { peg$fail(peg$c279); }
              }
              if (s6 !== peg$FAILED) {
                s7 = [];
                s8 = peg$parseWS();
                while (s8 !== peg$FAILED) {
                  s7.push(s8);
                  s8 = peg$parseWS();
                }
                if (s7 !== peg$FAILED) {
                  peg$savedPos = s0;
                  s1 = peg$c280(s4);
                  s0 = s1;
                } else {
                  peg$currPos = s0;
                  s0 = peg$FAILED;
                }
              } else {
                peg$currPos = s0;
                s0 = peg$FAILED;
              }
            } else {
              peg$currPos = s0;
              s0 = peg$FAILED;
            }
          } else {
            peg$currPos = s0;
            s0 = peg$FAILED;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }

    return s0;
  }

  function peg$parseBlankNodePropertyListPath() {
    var s0, s1, s2, s3, s4, s5, s6, s7;

    s0 = peg$currPos;
    s1 = [];
    s2 = peg$parseWS();
    while (s2 !== peg$FAILED) {
      s1.push(s2);
      s2 = peg$parseWS();
    }
    if (s1 !== peg$FAILED) {
      if (input.charCodeAt(peg$currPos) === 91) {
        s2 = peg$c276;
        peg$currPos++;
      } else {
        s2 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c277); }
      }
      if (s2 !== peg$FAILED) {
        s3 = [];
        s4 = peg$parseWS();
        while (s4 !== peg$FAILED) {
          s3.push(s4);
          s4 = peg$parseWS();
        }
        if (s3 !== peg$FAILED) {
          s4 = peg$parsePropertyListNotEmptyPath();
          if (s4 !== peg$FAILED) {
            if (input.charCodeAt(peg$currPos) === 93) {
              s5 = peg$c278;
              peg$currPos++;
            } else {
              s5 = peg$FAILED;
              if (peg$silentFails === 0) { peg$fail(peg$c279); }
            }
            if (s5 !== peg$FAILED) {
              s6 = [];
              s7 = peg$parseWS();
              while (s7 !== peg$FAILED) {
                s6.push(s7);
                s7 = peg$parseWS();
              }
              if (s6 !== peg$FAILED) {
                peg$savedPos = s0;
                s1 = peg$c280(s4);
                s0 = s1;
              } else {
                peg$currPos = s0;
                s0 = peg$FAILED;
              }
            } else {
              peg$currPos = s0;
              s0 = peg$FAILED;
            }
          } else {
            peg$currPos = s0;
            s0 = peg$FAILED;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }

    return s0;
  }

  function peg$parseCollection() {
    var s0, s1, s2, s3, s4, s5, s6, s7, s8;

    s0 = peg$currPos;
    s1 = [];
    s2 = peg$parseWS();
    while (s2 !== peg$FAILED) {
      s1.push(s2);
      s2 = peg$parseWS();
    }
    if (s1 !== peg$FAILED) {
      if (input.charCodeAt(peg$currPos) === 40) {
        s2 = peg$c27;
        peg$currPos++;
      } else {
        s2 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c28); }
      }
      if (s2 !== peg$FAILED) {
        s3 = [];
        s4 = peg$parseWS();
        while (s4 !== peg$FAILED) {
          s3.push(s4);
          s4 = peg$parseWS();
        }
        if (s3 !== peg$FAILED) {
          s4 = [];
          s5 = peg$parseGraphNode();
          if (s5 !== peg$FAILED) {
            while (s5 !== peg$FAILED) {
              s4.push(s5);
              s5 = peg$parseGraphNode();
            }
          } else {
            s4 = peg$FAILED;
          }
          if (s4 !== peg$FAILED) {
            s5 = [];
            s6 = peg$parseWS();
            while (s6 !== peg$FAILED) {
              s5.push(s6);
              s6 = peg$parseWS();
            }
            if (s5 !== peg$FAILED) {
              if (input.charCodeAt(peg$currPos) === 41) {
                s6 = peg$c33;
                peg$currPos++;
              } else {
                s6 = peg$FAILED;
                if (peg$silentFails === 0) { peg$fail(peg$c34); }
              }
              if (s6 !== peg$FAILED) {
                s7 = [];
                s8 = peg$parseWS();
                while (s8 !== peg$FAILED) {
                  s7.push(s8);
                  s8 = peg$parseWS();
                }
                if (s7 !== peg$FAILED) {
                  peg$savedPos = s0;
                  s1 = peg$c281(s4);
                  s0 = s1;
                } else {
                  peg$currPos = s0;
                  s0 = peg$FAILED;
                }
              } else {
                peg$currPos = s0;
                s0 = peg$FAILED;
              }
            } else {
              peg$currPos = s0;
              s0 = peg$FAILED;
            }
          } else {
            peg$currPos = s0;
            s0 = peg$FAILED;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }

    return s0;
  }

  function peg$parseCollectionPath() {
    var s0, s1, s2, s3, s4, s5, s6, s7, s8;

    s0 = peg$currPos;
    s1 = [];
    s2 = peg$parseWS();
    while (s2 !== peg$FAILED) {
      s1.push(s2);
      s2 = peg$parseWS();
    }
    if (s1 !== peg$FAILED) {
      if (input.charCodeAt(peg$currPos) === 40) {
        s2 = peg$c27;
        peg$currPos++;
      } else {
        s2 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c28); }
      }
      if (s2 !== peg$FAILED) {
        s3 = [];
        s4 = peg$parseWS();
        while (s4 !== peg$FAILED) {
          s3.push(s4);
          s4 = peg$parseWS();
        }
        if (s3 !== peg$FAILED) {
          s4 = [];
          s5 = peg$parseGraphNodePath();
          if (s5 !== peg$FAILED) {
            while (s5 !== peg$FAILED) {
              s4.push(s5);
              s5 = peg$parseGraphNodePath();
            }
          } else {
            s4 = peg$FAILED;
          }
          if (s4 !== peg$FAILED) {
            s5 = [];
            s6 = peg$parseWS();
            while (s6 !== peg$FAILED) {
              s5.push(s6);
              s6 = peg$parseWS();
            }
            if (s5 !== peg$FAILED) {
              if (input.charCodeAt(peg$currPos) === 41) {
                s6 = peg$c33;
                peg$currPos++;
              } else {
                s6 = peg$FAILED;
                if (peg$silentFails === 0) { peg$fail(peg$c34); }
              }
              if (s6 !== peg$FAILED) {
                s7 = [];
                s8 = peg$parseWS();
                while (s8 !== peg$FAILED) {
                  s7.push(s8);
                  s8 = peg$parseWS();
                }
                if (s7 !== peg$FAILED) {
                  peg$savedPos = s0;
                  s1 = peg$c281(s4);
                  s0 = s1;
                } else {
                  peg$currPos = s0;
                  s0 = peg$FAILED;
                }
              } else {
                peg$currPos = s0;
                s0 = peg$FAILED;
              }
            } else {
              peg$currPos = s0;
              s0 = peg$FAILED;
            }
          } else {
            peg$currPos = s0;
            s0 = peg$FAILED;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }

    return s0;
  }

  function peg$parseGraphNode() {
    var s0, s1, s2, s3, s4, s5;

    s0 = peg$currPos;
    s1 = peg$currPos;
    s2 = [];
    s3 = peg$parseWS();
    while (s3 !== peg$FAILED) {
      s2.push(s3);
      s3 = peg$parseWS();
    }
    if (s2 !== peg$FAILED) {
      s3 = peg$parseVarOrTerm();
      if (s3 !== peg$FAILED) {
        s4 = [];
        s5 = peg$parseWS();
        while (s5 !== peg$FAILED) {
          s4.push(s5);
          s5 = peg$parseWS();
        }
        if (s4 !== peg$FAILED) {
          s2 = [s2, s3, s4];
          s1 = s2;
        } else {
          peg$currPos = s1;
          s1 = peg$FAILED;
        }
      } else {
        peg$currPos = s1;
        s1 = peg$FAILED;
      }
    } else {
      peg$currPos = s1;
      s1 = peg$FAILED;
    }
    if (s1 === peg$FAILED) {
      s1 = peg$currPos;
      s2 = [];
      s3 = peg$parseWS();
      while (s3 !== peg$FAILED) {
        s2.push(s3);
        s3 = peg$parseWS();
      }
      if (s2 !== peg$FAILED) {
        s3 = peg$parseTriplesNode();
        if (s3 !== peg$FAILED) {
          s4 = [];
          s5 = peg$parseWS();
          while (s5 !== peg$FAILED) {
            s4.push(s5);
            s5 = peg$parseWS();
          }
          if (s4 !== peg$FAILED) {
            s2 = [s2, s3, s4];
            s1 = s2;
          } else {
            peg$currPos = s1;
            s1 = peg$FAILED;
          }
        } else {
          peg$currPos = s1;
          s1 = peg$FAILED;
        }
      } else {
        peg$currPos = s1;
        s1 = peg$FAILED;
      }
    }
    if (s1 !== peg$FAILED) {
      peg$savedPos = s0;
      s1 = peg$c282(s1);
    }
    s0 = s1;

    return s0;
  }

  function peg$parseGraphNodePath() {
    var s0, s1, s2, s3, s4, s5;

    s0 = peg$currPos;
    s1 = peg$currPos;
    s2 = [];
    s3 = peg$parseWS();
    while (s3 !== peg$FAILED) {
      s2.push(s3);
      s3 = peg$parseWS();
    }
    if (s2 !== peg$FAILED) {
      s3 = peg$parseVarOrTerm();
      if (s3 !== peg$FAILED) {
        s4 = [];
        s5 = peg$parseWS();
        while (s5 !== peg$FAILED) {
          s4.push(s5);
          s5 = peg$parseWS();
        }
        if (s4 !== peg$FAILED) {
          s2 = [s2, s3, s4];
          s1 = s2;
        } else {
          peg$currPos = s1;
          s1 = peg$FAILED;
        }
      } else {
        peg$currPos = s1;
        s1 = peg$FAILED;
      }
    } else {
      peg$currPos = s1;
      s1 = peg$FAILED;
    }
    if (s1 === peg$FAILED) {
      s1 = peg$currPos;
      s2 = [];
      s3 = peg$parseWS();
      while (s3 !== peg$FAILED) {
        s2.push(s3);
        s3 = peg$parseWS();
      }
      if (s2 !== peg$FAILED) {
        s3 = peg$parseTriplesNodePath();
        if (s3 !== peg$FAILED) {
          s4 = [];
          s5 = peg$parseWS();
          while (s5 !== peg$FAILED) {
            s4.push(s5);
            s5 = peg$parseWS();
          }
          if (s4 !== peg$FAILED) {
            s2 = [s2, s3, s4];
            s1 = s2;
          } else {
            peg$currPos = s1;
            s1 = peg$FAILED;
          }
        } else {
          peg$currPos = s1;
          s1 = peg$FAILED;
        }
      } else {
        peg$currPos = s1;
        s1 = peg$FAILED;
      }
    }
    if (s1 !== peg$FAILED) {
      peg$savedPos = s0;
      s1 = peg$c282(s1);
    }
    s0 = s1;

    return s0;
  }

  function peg$parseVarOrTerm() {
    var s0;

    s0 = peg$parseVar();
    if (s0 === peg$FAILED) {
      s0 = peg$parseGraphTerm();
    }

    return s0;
  }

  function peg$parseVarOrIRIref() {
    var s0;

    s0 = peg$parseVar();
    if (s0 === peg$FAILED) {
      s0 = peg$parseIRIref();
    }

    return s0;
  }

  function peg$parseVar() {
    var s0, s1, s2, s3, s4;

    s0 = peg$currPos;
    s1 = [];
    s2 = peg$parseWS();
    while (s2 !== peg$FAILED) {
      s1.push(s2);
      s2 = peg$parseWS();
    }
    if (s1 !== peg$FAILED) {
      s2 = peg$parseVAR1();
      if (s2 === peg$FAILED) {
        s2 = peg$parseVAR2();
        if (s2 === peg$FAILED) {
          s2 = peg$parseVAR3();
        }
      }
      if (s2 !== peg$FAILED) {
        s3 = [];
        s4 = peg$parseWS();
        while (s4 !== peg$FAILED) {
          s3.push(s4);
          s4 = peg$parseWS();
        }
        if (s3 !== peg$FAILED) {
          peg$savedPos = s0;
          s1 = peg$c283(s2);
          s0 = s1;
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }

    return s0;
  }

  function peg$parseGraphTerm() {
    var s0;

    s0 = peg$parseIRIref();
    if (s0 === peg$FAILED) {
      s0 = peg$parseRDFLiteral();
      if (s0 === peg$FAILED) {
        s0 = peg$parseNumericLiteral();
        if (s0 === peg$FAILED) {
          s0 = peg$parseBooleanLiteral();
          if (s0 === peg$FAILED) {
            s0 = peg$parseBlankNode();
            if (s0 === peg$FAILED) {
              s0 = peg$parseNIL();
            }
          }
        }
      }
    }

    return s0;
  }

  function peg$parseConditionalOrExpression() {
    var s0, s1, s2, s3, s4, s5, s6, s7;

    s0 = peg$currPos;
    s1 = peg$parseConditionalAndExpression();
    if (s1 !== peg$FAILED) {
      s2 = [];
      s3 = peg$currPos;
      s4 = [];
      s5 = peg$parseWS();
      while (s5 !== peg$FAILED) {
        s4.push(s5);
        s5 = peg$parseWS();
      }
      if (s4 !== peg$FAILED) {
        if (input.substr(peg$currPos, 2) === peg$c284) {
          s5 = peg$c284;
          peg$currPos += 2;
        } else {
          s5 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c285); }
        }
        if (s5 !== peg$FAILED) {
          s6 = [];
          s7 = peg$parseWS();
          while (s7 !== peg$FAILED) {
            s6.push(s7);
            s7 = peg$parseWS();
          }
          if (s6 !== peg$FAILED) {
            s7 = peg$parseConditionalAndExpression();
            if (s7 !== peg$FAILED) {
              s4 = [s4, s5, s6, s7];
              s3 = s4;
            } else {
              peg$currPos = s3;
              s3 = peg$FAILED;
            }
          } else {
            peg$currPos = s3;
            s3 = peg$FAILED;
          }
        } else {
          peg$currPos = s3;
          s3 = peg$FAILED;
        }
      } else {
        peg$currPos = s3;
        s3 = peg$FAILED;
      }
      while (s3 !== peg$FAILED) {
        s2.push(s3);
        s3 = peg$currPos;
        s4 = [];
        s5 = peg$parseWS();
        while (s5 !== peg$FAILED) {
          s4.push(s5);
          s5 = peg$parseWS();
        }
        if (s4 !== peg$FAILED) {
          if (input.substr(peg$currPos, 2) === peg$c284) {
            s5 = peg$c284;
            peg$currPos += 2;
          } else {
            s5 = peg$FAILED;
            if (peg$silentFails === 0) { peg$fail(peg$c285); }
          }
          if (s5 !== peg$FAILED) {
            s6 = [];
            s7 = peg$parseWS();
            while (s7 !== peg$FAILED) {
              s6.push(s7);
              s7 = peg$parseWS();
            }
            if (s6 !== peg$FAILED) {
              s7 = peg$parseConditionalAndExpression();
              if (s7 !== peg$FAILED) {
                s4 = [s4, s5, s6, s7];
                s3 = s4;
              } else {
                peg$currPos = s3;
                s3 = peg$FAILED;
              }
            } else {
              peg$currPos = s3;
              s3 = peg$FAILED;
            }
          } else {
            peg$currPos = s3;
            s3 = peg$FAILED;
          }
        } else {
          peg$currPos = s3;
          s3 = peg$FAILED;
        }
      }
      if (s2 !== peg$FAILED) {
        peg$savedPos = s0;
        s1 = peg$c286(s1, s2);
        s0 = s1;
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }

    return s0;
  }

  function peg$parseConditionalAndExpression() {
    var s0, s1, s2, s3, s4, s5, s6, s7;

    s0 = peg$currPos;
    s1 = peg$parseRelationalExpression();
    if (s1 !== peg$FAILED) {
      s2 = [];
      s3 = peg$currPos;
      s4 = [];
      s5 = peg$parseWS();
      while (s5 !== peg$FAILED) {
        s4.push(s5);
        s5 = peg$parseWS();
      }
      if (s4 !== peg$FAILED) {
        if (input.substr(peg$currPos, 2) === peg$c287) {
          s5 = peg$c287;
          peg$currPos += 2;
        } else {
          s5 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c288); }
        }
        if (s5 !== peg$FAILED) {
          s6 = [];
          s7 = peg$parseWS();
          while (s7 !== peg$FAILED) {
            s6.push(s7);
            s7 = peg$parseWS();
          }
          if (s6 !== peg$FAILED) {
            s7 = peg$parseRelationalExpression();
            if (s7 !== peg$FAILED) {
              s4 = [s4, s5, s6, s7];
              s3 = s4;
            } else {
              peg$currPos = s3;
              s3 = peg$FAILED;
            }
          } else {
            peg$currPos = s3;
            s3 = peg$FAILED;
          }
        } else {
          peg$currPos = s3;
          s3 = peg$FAILED;
        }
      } else {
        peg$currPos = s3;
        s3 = peg$FAILED;
      }
      while (s3 !== peg$FAILED) {
        s2.push(s3);
        s3 = peg$currPos;
        s4 = [];
        s5 = peg$parseWS();
        while (s5 !== peg$FAILED) {
          s4.push(s5);
          s5 = peg$parseWS();
        }
        if (s4 !== peg$FAILED) {
          if (input.substr(peg$currPos, 2) === peg$c287) {
            s5 = peg$c287;
            peg$currPos += 2;
          } else {
            s5 = peg$FAILED;
            if (peg$silentFails === 0) { peg$fail(peg$c288); }
          }
          if (s5 !== peg$FAILED) {
            s6 = [];
            s7 = peg$parseWS();
            while (s7 !== peg$FAILED) {
              s6.push(s7);
              s7 = peg$parseWS();
            }
            if (s6 !== peg$FAILED) {
              s7 = peg$parseRelationalExpression();
              if (s7 !== peg$FAILED) {
                s4 = [s4, s5, s6, s7];
                s3 = s4;
              } else {
                peg$currPos = s3;
                s3 = peg$FAILED;
              }
            } else {
              peg$currPos = s3;
              s3 = peg$FAILED;
            }
          } else {
            peg$currPos = s3;
            s3 = peg$FAILED;
          }
        } else {
          peg$currPos = s3;
          s3 = peg$FAILED;
        }
      }
      if (s2 !== peg$FAILED) {
        peg$savedPos = s0;
        s1 = peg$c289(s1, s2);
        s0 = s1;
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }

    return s0;
  }

  function peg$parseRelationalExpression() {
    var s0, s1, s2, s3, s4, s5, s6, s7, s8, s9, s10, s11, s12;

    s0 = peg$currPos;
    s1 = peg$parseAdditiveExpression();
    if (s1 !== peg$FAILED) {
      s2 = [];
      s3 = peg$currPos;
      s4 = [];
      s5 = peg$parseWS();
      while (s5 !== peg$FAILED) {
        s4.push(s5);
        s5 = peg$parseWS();
      }
      if (s4 !== peg$FAILED) {
        if (input.charCodeAt(peg$currPos) === 61) {
          s5 = peg$c290;
          peg$currPos++;
        } else {
          s5 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c291); }
        }
        if (s5 !== peg$FAILED) {
          s6 = [];
          s7 = peg$parseWS();
          while (s7 !== peg$FAILED) {
            s6.push(s7);
            s7 = peg$parseWS();
          }
          if (s6 !== peg$FAILED) {
            s7 = peg$parseAdditiveExpression();
            if (s7 !== peg$FAILED) {
              s4 = [s4, s5, s6, s7];
              s3 = s4;
            } else {
              peg$currPos = s3;
              s3 = peg$FAILED;
            }
          } else {
            peg$currPos = s3;
            s3 = peg$FAILED;
          }
        } else {
          peg$currPos = s3;
          s3 = peg$FAILED;
        }
      } else {
        peg$currPos = s3;
        s3 = peg$FAILED;
      }
      if (s3 === peg$FAILED) {
        s3 = peg$currPos;
        s4 = [];
        s5 = peg$parseWS();
        while (s5 !== peg$FAILED) {
          s4.push(s5);
          s5 = peg$parseWS();
        }
        if (s4 !== peg$FAILED) {
          if (input.substr(peg$currPos, 2) === peg$c292) {
            s5 = peg$c292;
            peg$currPos += 2;
          } else {
            s5 = peg$FAILED;
            if (peg$silentFails === 0) { peg$fail(peg$c293); }
          }
          if (s5 !== peg$FAILED) {
            s6 = [];
            s7 = peg$parseWS();
            while (s7 !== peg$FAILED) {
              s6.push(s7);
              s7 = peg$parseWS();
            }
            if (s6 !== peg$FAILED) {
              s7 = peg$parseAdditiveExpression();
              if (s7 !== peg$FAILED) {
                s4 = [s4, s5, s6, s7];
                s3 = s4;
              } else {
                peg$currPos = s3;
                s3 = peg$FAILED;
              }
            } else {
              peg$currPos = s3;
              s3 = peg$FAILED;
            }
          } else {
            peg$currPos = s3;
            s3 = peg$FAILED;
          }
        } else {
          peg$currPos = s3;
          s3 = peg$FAILED;
        }
        if (s3 === peg$FAILED) {
          s3 = peg$currPos;
          s4 = [];
          s5 = peg$parseWS();
          while (s5 !== peg$FAILED) {
            s4.push(s5);
            s5 = peg$parseWS();
          }
          if (s4 !== peg$FAILED) {
            if (input.charCodeAt(peg$currPos) === 60) {
              s5 = peg$c294;
              peg$currPos++;
            } else {
              s5 = peg$FAILED;
              if (peg$silentFails === 0) { peg$fail(peg$c295); }
            }
            if (s5 !== peg$FAILED) {
              s6 = [];
              s7 = peg$parseWS();
              while (s7 !== peg$FAILED) {
                s6.push(s7);
                s7 = peg$parseWS();
              }
              if (s6 !== peg$FAILED) {
                s7 = peg$parseAdditiveExpression();
                if (s7 !== peg$FAILED) {
                  s4 = [s4, s5, s6, s7];
                  s3 = s4;
                } else {
                  peg$currPos = s3;
                  s3 = peg$FAILED;
                }
              } else {
                peg$currPos = s3;
                s3 = peg$FAILED;
              }
            } else {
              peg$currPos = s3;
              s3 = peg$FAILED;
            }
          } else {
            peg$currPos = s3;
            s3 = peg$FAILED;
          }
          if (s3 === peg$FAILED) {
            s3 = peg$currPos;
            s4 = [];
            s5 = peg$parseWS();
            while (s5 !== peg$FAILED) {
              s4.push(s5);
              s5 = peg$parseWS();
            }
            if (s4 !== peg$FAILED) {
              if (input.charCodeAt(peg$currPos) === 62) {
                s5 = peg$c296;
                peg$currPos++;
              } else {
                s5 = peg$FAILED;
                if (peg$silentFails === 0) { peg$fail(peg$c297); }
              }
              if (s5 !== peg$FAILED) {
                s6 = [];
                s7 = peg$parseWS();
                while (s7 !== peg$FAILED) {
                  s6.push(s7);
                  s7 = peg$parseWS();
                }
                if (s6 !== peg$FAILED) {
                  s7 = peg$parseAdditiveExpression();
                  if (s7 !== peg$FAILED) {
                    s4 = [s4, s5, s6, s7];
                    s3 = s4;
                  } else {
                    peg$currPos = s3;
                    s3 = peg$FAILED;
                  }
                } else {
                  peg$currPos = s3;
                  s3 = peg$FAILED;
                }
              } else {
                peg$currPos = s3;
                s3 = peg$FAILED;
              }
            } else {
              peg$currPos = s3;
              s3 = peg$FAILED;
            }
            if (s3 === peg$FAILED) {
              s3 = peg$currPos;
              s4 = [];
              s5 = peg$parseWS();
              while (s5 !== peg$FAILED) {
                s4.push(s5);
                s5 = peg$parseWS();
              }
              if (s4 !== peg$FAILED) {
                if (input.substr(peg$currPos, 2) === peg$c298) {
                  s5 = peg$c298;
                  peg$currPos += 2;
                } else {
                  s5 = peg$FAILED;
                  if (peg$silentFails === 0) { peg$fail(peg$c299); }
                }
                if (s5 !== peg$FAILED) {
                  s6 = [];
                  s7 = peg$parseWS();
                  while (s7 !== peg$FAILED) {
                    s6.push(s7);
                    s7 = peg$parseWS();
                  }
                  if (s6 !== peg$FAILED) {
                    s7 = peg$parseAdditiveExpression();
                    if (s7 !== peg$FAILED) {
                      s4 = [s4, s5, s6, s7];
                      s3 = s4;
                    } else {
                      peg$currPos = s3;
                      s3 = peg$FAILED;
                    }
                  } else {
                    peg$currPos = s3;
                    s3 = peg$FAILED;
                  }
                } else {
                  peg$currPos = s3;
                  s3 = peg$FAILED;
                }
              } else {
                peg$currPos = s3;
                s3 = peg$FAILED;
              }
              if (s3 === peg$FAILED) {
                s3 = peg$currPos;
                s4 = [];
                s5 = peg$parseWS();
                while (s5 !== peg$FAILED) {
                  s4.push(s5);
                  s5 = peg$parseWS();
                }
                if (s4 !== peg$FAILED) {
                  if (input.substr(peg$currPos, 2) === peg$c300) {
                    s5 = peg$c300;
                    peg$currPos += 2;
                  } else {
                    s5 = peg$FAILED;
                    if (peg$silentFails === 0) { peg$fail(peg$c301); }
                  }
                  if (s5 !== peg$FAILED) {
                    s6 = [];
                    s7 = peg$parseWS();
                    while (s7 !== peg$FAILED) {
                      s6.push(s7);
                      s7 = peg$parseWS();
                    }
                    if (s6 !== peg$FAILED) {
                      s7 = peg$parseAdditiveExpression();
                      if (s7 !== peg$FAILED) {
                        s4 = [s4, s5, s6, s7];
                        s3 = s4;
                      } else {
                        peg$currPos = s3;
                        s3 = peg$FAILED;
                      }
                    } else {
                      peg$currPos = s3;
                      s3 = peg$FAILED;
                    }
                  } else {
                    peg$currPos = s3;
                    s3 = peg$FAILED;
                  }
                } else {
                  peg$currPos = s3;
                  s3 = peg$FAILED;
                }
                if (s3 === peg$FAILED) {
                  s3 = peg$currPos;
                  s4 = [];
                  s5 = peg$parseWS();
                  while (s5 !== peg$FAILED) {
                    s4.push(s5);
                    s5 = peg$parseWS();
                  }
                  if (s4 !== peg$FAILED) {
                    if (input.charCodeAt(peg$currPos) === 73) {
                      s5 = peg$c302;
                      peg$currPos++;
                    } else {
                      s5 = peg$FAILED;
                      if (peg$silentFails === 0) { peg$fail(peg$c303); }
                    }
                    if (s5 === peg$FAILED) {
                      if (input.charCodeAt(peg$currPos) === 105) {
                        s5 = peg$c304;
                        peg$currPos++;
                      } else {
                        s5 = peg$FAILED;
                        if (peg$silentFails === 0) { peg$fail(peg$c305); }
                      }
                    }
                    if (s5 !== peg$FAILED) {
                      if (input.charCodeAt(peg$currPos) === 78) {
                        s6 = peg$c306;
                        peg$currPos++;
                      } else {
                        s6 = peg$FAILED;
                        if (peg$silentFails === 0) { peg$fail(peg$c307); }
                      }
                      if (s6 === peg$FAILED) {
                        if (input.charCodeAt(peg$currPos) === 110) {
                          s6 = peg$c308;
                          peg$currPos++;
                        } else {
                          s6 = peg$FAILED;
                          if (peg$silentFails === 0) { peg$fail(peg$c309); }
                        }
                      }
                      if (s6 !== peg$FAILED) {
                        s7 = [];
                        s8 = peg$parseWS();
                        while (s8 !== peg$FAILED) {
                          s7.push(s8);
                          s8 = peg$parseWS();
                        }
                        if (s7 !== peg$FAILED) {
                          s8 = peg$parseExpressionList();
                          if (s8 !== peg$FAILED) {
                            s4 = [s4, s5, s6, s7, s8];
                            s3 = s4;
                          } else {
                            peg$currPos = s3;
                            s3 = peg$FAILED;
                          }
                        } else {
                          peg$currPos = s3;
                          s3 = peg$FAILED;
                        }
                      } else {
                        peg$currPos = s3;
                        s3 = peg$FAILED;
                      }
                    } else {
                      peg$currPos = s3;
                      s3 = peg$FAILED;
                    }
                  } else {
                    peg$currPos = s3;
                    s3 = peg$FAILED;
                  }
                  if (s3 === peg$FAILED) {
                    s3 = peg$currPos;
                    s4 = [];
                    s5 = peg$parseWS();
                    while (s5 !== peg$FAILED) {
                      s4.push(s5);
                      s5 = peg$parseWS();
                    }
                    if (s4 !== peg$FAILED) {
                      if (input.charCodeAt(peg$currPos) === 78) {
                        s5 = peg$c306;
                        peg$currPos++;
                      } else {
                        s5 = peg$FAILED;
                        if (peg$silentFails === 0) { peg$fail(peg$c307); }
                      }
                      if (s5 === peg$FAILED) {
                        if (input.charCodeAt(peg$currPos) === 110) {
                          s5 = peg$c308;
                          peg$currPos++;
                        } else {
                          s5 = peg$FAILED;
                          if (peg$silentFails === 0) { peg$fail(peg$c309); }
                        }
                      }
                      if (s5 !== peg$FAILED) {
                        if (input.charCodeAt(peg$currPos) === 79) {
                          s6 = peg$c310;
                          peg$currPos++;
                        } else {
                          s6 = peg$FAILED;
                          if (peg$silentFails === 0) { peg$fail(peg$c311); }
                        }
                        if (s6 === peg$FAILED) {
                          if (input.charCodeAt(peg$currPos) === 111) {
                            s6 = peg$c312;
                            peg$currPos++;
                          } else {
                            s6 = peg$FAILED;
                            if (peg$silentFails === 0) { peg$fail(peg$c313); }
                          }
                        }
                        if (s6 !== peg$FAILED) {
                          if (input.charCodeAt(peg$currPos) === 84) {
                            s7 = peg$c314;
                            peg$currPos++;
                          } else {
                            s7 = peg$FAILED;
                            if (peg$silentFails === 0) { peg$fail(peg$c315); }
                          }
                          if (s7 === peg$FAILED) {
                            if (input.charCodeAt(peg$currPos) === 116) {
                              s7 = peg$c316;
                              peg$currPos++;
                            } else {
                              s7 = peg$FAILED;
                              if (peg$silentFails === 0) { peg$fail(peg$c317); }
                            }
                          }
                          if (s7 !== peg$FAILED) {
                            s8 = [];
                            s9 = peg$parseWS();
                            while (s9 !== peg$FAILED) {
                              s8.push(s9);
                              s9 = peg$parseWS();
                            }
                            if (s8 !== peg$FAILED) {
                              if (input.charCodeAt(peg$currPos) === 73) {
                                s9 = peg$c302;
                                peg$currPos++;
                              } else {
                                s9 = peg$FAILED;
                                if (peg$silentFails === 0) { peg$fail(peg$c303); }
                              }
                              if (s9 === peg$FAILED) {
                                if (input.charCodeAt(peg$currPos) === 105) {
                                  s9 = peg$c304;
                                  peg$currPos++;
                                } else {
                                  s9 = peg$FAILED;
                                  if (peg$silentFails === 0) { peg$fail(peg$c305); }
                                }
                              }
                              if (s9 !== peg$FAILED) {
                                if (input.charCodeAt(peg$currPos) === 78) {
                                  s10 = peg$c306;
                                  peg$currPos++;
                                } else {
                                  s10 = peg$FAILED;
                                  if (peg$silentFails === 0) { peg$fail(peg$c307); }
                                }
                                if (s10 === peg$FAILED) {
                                  if (input.charCodeAt(peg$currPos) === 110) {
                                    s10 = peg$c308;
                                    peg$currPos++;
                                  } else {
                                    s10 = peg$FAILED;
                                    if (peg$silentFails === 0) { peg$fail(peg$c309); }
                                  }
                                }
                                if (s10 !== peg$FAILED) {
                                  s11 = [];
                                  s12 = peg$parseWS();
                                  while (s12 !== peg$FAILED) {
                                    s11.push(s12);
                                    s12 = peg$parseWS();
                                  }
                                  if (s11 !== peg$FAILED) {
                                    s12 = peg$parseExpressionList();
                                    if (s12 !== peg$FAILED) {
                                      s4 = [s4, s5, s6, s7, s8, s9, s10, s11, s12];
                                      s3 = s4;
                                    } else {
                                      peg$currPos = s3;
                                      s3 = peg$FAILED;
                                    }
                                  } else {
                                    peg$currPos = s3;
                                    s3 = peg$FAILED;
                                  }
                                } else {
                                  peg$currPos = s3;
                                  s3 = peg$FAILED;
                                }
                              } else {
                                peg$currPos = s3;
                                s3 = peg$FAILED;
                              }
                            } else {
                              peg$currPos = s3;
                              s3 = peg$FAILED;
                            }
                          } else {
                            peg$currPos = s3;
                            s3 = peg$FAILED;
                          }
                        } else {
                          peg$currPos = s3;
                          s3 = peg$FAILED;
                        }
                      } else {
                        peg$currPos = s3;
                        s3 = peg$FAILED;
                      }
                    } else {
                      peg$currPos = s3;
                      s3 = peg$FAILED;
                    }
                  }
                }
              }
            }
          }
        }
      }
      while (s3 !== peg$FAILED) {
        s2.push(s3);
        s3 = peg$currPos;
        s4 = [];
        s5 = peg$parseWS();
        while (s5 !== peg$FAILED) {
          s4.push(s5);
          s5 = peg$parseWS();
        }
        if (s4 !== peg$FAILED) {
          if (input.charCodeAt(peg$currPos) === 61) {
            s5 = peg$c290;
            peg$currPos++;
          } else {
            s5 = peg$FAILED;
            if (peg$silentFails === 0) { peg$fail(peg$c291); }
          }
          if (s5 !== peg$FAILED) {
            s6 = [];
            s7 = peg$parseWS();
            while (s7 !== peg$FAILED) {
              s6.push(s7);
              s7 = peg$parseWS();
            }
            if (s6 !== peg$FAILED) {
              s7 = peg$parseAdditiveExpression();
              if (s7 !== peg$FAILED) {
                s4 = [s4, s5, s6, s7];
                s3 = s4;
              } else {
                peg$currPos = s3;
                s3 = peg$FAILED;
              }
            } else {
              peg$currPos = s3;
              s3 = peg$FAILED;
            }
          } else {
            peg$currPos = s3;
            s3 = peg$FAILED;
          }
        } else {
          peg$currPos = s3;
          s3 = peg$FAILED;
        }
        if (s3 === peg$FAILED) {
          s3 = peg$currPos;
          s4 = [];
          s5 = peg$parseWS();
          while (s5 !== peg$FAILED) {
            s4.push(s5);
            s5 = peg$parseWS();
          }
          if (s4 !== peg$FAILED) {
            if (input.substr(peg$currPos, 2) === peg$c292) {
              s5 = peg$c292;
              peg$currPos += 2;
            } else {
              s5 = peg$FAILED;
              if (peg$silentFails === 0) { peg$fail(peg$c293); }
            }
            if (s5 !== peg$FAILED) {
              s6 = [];
              s7 = peg$parseWS();
              while (s7 !== peg$FAILED) {
                s6.push(s7);
                s7 = peg$parseWS();
              }
              if (s6 !== peg$FAILED) {
                s7 = peg$parseAdditiveExpression();
                if (s7 !== peg$FAILED) {
                  s4 = [s4, s5, s6, s7];
                  s3 = s4;
                } else {
                  peg$currPos = s3;
                  s3 = peg$FAILED;
                }
              } else {
                peg$currPos = s3;
                s3 = peg$FAILED;
              }
            } else {
              peg$currPos = s3;
              s3 = peg$FAILED;
            }
          } else {
            peg$currPos = s3;
            s3 = peg$FAILED;
          }
          if (s3 === peg$FAILED) {
            s3 = peg$currPos;
            s4 = [];
            s5 = peg$parseWS();
            while (s5 !== peg$FAILED) {
              s4.push(s5);
              s5 = peg$parseWS();
            }
            if (s4 !== peg$FAILED) {
              if (input.charCodeAt(peg$currPos) === 60) {
                s5 = peg$c294;
                peg$currPos++;
              } else {
                s5 = peg$FAILED;
                if (peg$silentFails === 0) { peg$fail(peg$c295); }
              }
              if (s5 !== peg$FAILED) {
                s6 = [];
                s7 = peg$parseWS();
                while (s7 !== peg$FAILED) {
                  s6.push(s7);
                  s7 = peg$parseWS();
                }
                if (s6 !== peg$FAILED) {
                  s7 = peg$parseAdditiveExpression();
                  if (s7 !== peg$FAILED) {
                    s4 = [s4, s5, s6, s7];
                    s3 = s4;
                  } else {
                    peg$currPos = s3;
                    s3 = peg$FAILED;
                  }
                } else {
                  peg$currPos = s3;
                  s3 = peg$FAILED;
                }
              } else {
                peg$currPos = s3;
                s3 = peg$FAILED;
              }
            } else {
              peg$currPos = s3;
              s3 = peg$FAILED;
            }
            if (s3 === peg$FAILED) {
              s3 = peg$currPos;
              s4 = [];
              s5 = peg$parseWS();
              while (s5 !== peg$FAILED) {
                s4.push(s5);
                s5 = peg$parseWS();
              }
              if (s4 !== peg$FAILED) {
                if (input.charCodeAt(peg$currPos) === 62) {
                  s5 = peg$c296;
                  peg$currPos++;
                } else {
                  s5 = peg$FAILED;
                  if (peg$silentFails === 0) { peg$fail(peg$c297); }
                }
                if (s5 !== peg$FAILED) {
                  s6 = [];
                  s7 = peg$parseWS();
                  while (s7 !== peg$FAILED) {
                    s6.push(s7);
                    s7 = peg$parseWS();
                  }
                  if (s6 !== peg$FAILED) {
                    s7 = peg$parseAdditiveExpression();
                    if (s7 !== peg$FAILED) {
                      s4 = [s4, s5, s6, s7];
                      s3 = s4;
                    } else {
                      peg$currPos = s3;
                      s3 = peg$FAILED;
                    }
                  } else {
                    peg$currPos = s3;
                    s3 = peg$FAILED;
                  }
                } else {
                  peg$currPos = s3;
                  s3 = peg$FAILED;
                }
              } else {
                peg$currPos = s3;
                s3 = peg$FAILED;
              }
              if (s3 === peg$FAILED) {
                s3 = peg$currPos;
                s4 = [];
                s5 = peg$parseWS();
                while (s5 !== peg$FAILED) {
                  s4.push(s5);
                  s5 = peg$parseWS();
                }
                if (s4 !== peg$FAILED) {
                  if (input.substr(peg$currPos, 2) === peg$c298) {
                    s5 = peg$c298;
                    peg$currPos += 2;
                  } else {
                    s5 = peg$FAILED;
                    if (peg$silentFails === 0) { peg$fail(peg$c299); }
                  }
                  if (s5 !== peg$FAILED) {
                    s6 = [];
                    s7 = peg$parseWS();
                    while (s7 !== peg$FAILED) {
                      s6.push(s7);
                      s7 = peg$parseWS();
                    }
                    if (s6 !== peg$FAILED) {
                      s7 = peg$parseAdditiveExpression();
                      if (s7 !== peg$FAILED) {
                        s4 = [s4, s5, s6, s7];
                        s3 = s4;
                      } else {
                        peg$currPos = s3;
                        s3 = peg$FAILED;
                      }
                    } else {
                      peg$currPos = s3;
                      s3 = peg$FAILED;
                    }
                  } else {
                    peg$currPos = s3;
                    s3 = peg$FAILED;
                  }
                } else {
                  peg$currPos = s3;
                  s3 = peg$FAILED;
                }
                if (s3 === peg$FAILED) {
                  s3 = peg$currPos;
                  s4 = [];
                  s5 = peg$parseWS();
                  while (s5 !== peg$FAILED) {
                    s4.push(s5);
                    s5 = peg$parseWS();
                  }
                  if (s4 !== peg$FAILED) {
                    if (input.substr(peg$currPos, 2) === peg$c300) {
                      s5 = peg$c300;
                      peg$currPos += 2;
                    } else {
                      s5 = peg$FAILED;
                      if (peg$silentFails === 0) { peg$fail(peg$c301); }
                    }
                    if (s5 !== peg$FAILED) {
                      s6 = [];
                      s7 = peg$parseWS();
                      while (s7 !== peg$FAILED) {
                        s6.push(s7);
                        s7 = peg$parseWS();
                      }
                      if (s6 !== peg$FAILED) {
                        s7 = peg$parseAdditiveExpression();
                        if (s7 !== peg$FAILED) {
                          s4 = [s4, s5, s6, s7];
                          s3 = s4;
                        } else {
                          peg$currPos = s3;
                          s3 = peg$FAILED;
                        }
                      } else {
                        peg$currPos = s3;
                        s3 = peg$FAILED;
                      }
                    } else {
                      peg$currPos = s3;
                      s3 = peg$FAILED;
                    }
                  } else {
                    peg$currPos = s3;
                    s3 = peg$FAILED;
                  }
                  if (s3 === peg$FAILED) {
                    s3 = peg$currPos;
                    s4 = [];
                    s5 = peg$parseWS();
                    while (s5 !== peg$FAILED) {
                      s4.push(s5);
                      s5 = peg$parseWS();
                    }
                    if (s4 !== peg$FAILED) {
                      if (input.charCodeAt(peg$currPos) === 73) {
                        s5 = peg$c302;
                        peg$currPos++;
                      } else {
                        s5 = peg$FAILED;
                        if (peg$silentFails === 0) { peg$fail(peg$c303); }
                      }
                      if (s5 === peg$FAILED) {
                        if (input.charCodeAt(peg$currPos) === 105) {
                          s5 = peg$c304;
                          peg$currPos++;
                        } else {
                          s5 = peg$FAILED;
                          if (peg$silentFails === 0) { peg$fail(peg$c305); }
                        }
                      }
                      if (s5 !== peg$FAILED) {
                        if (input.charCodeAt(peg$currPos) === 78) {
                          s6 = peg$c306;
                          peg$currPos++;
                        } else {
                          s6 = peg$FAILED;
                          if (peg$silentFails === 0) { peg$fail(peg$c307); }
                        }
                        if (s6 === peg$FAILED) {
                          if (input.charCodeAt(peg$currPos) === 110) {
                            s6 = peg$c308;
                            peg$currPos++;
                          } else {
                            s6 = peg$FAILED;
                            if (peg$silentFails === 0) { peg$fail(peg$c309); }
                          }
                        }
                        if (s6 !== peg$FAILED) {
                          s7 = [];
                          s8 = peg$parseWS();
                          while (s8 !== peg$FAILED) {
                            s7.push(s8);
                            s8 = peg$parseWS();
                          }
                          if (s7 !== peg$FAILED) {
                            s8 = peg$parseExpressionList();
                            if (s8 !== peg$FAILED) {
                              s4 = [s4, s5, s6, s7, s8];
                              s3 = s4;
                            } else {
                              peg$currPos = s3;
                              s3 = peg$FAILED;
                            }
                          } else {
                            peg$currPos = s3;
                            s3 = peg$FAILED;
                          }
                        } else {
                          peg$currPos = s3;
                          s3 = peg$FAILED;
                        }
                      } else {
                        peg$currPos = s3;
                        s3 = peg$FAILED;
                      }
                    } else {
                      peg$currPos = s3;
                      s3 = peg$FAILED;
                    }
                    if (s3 === peg$FAILED) {
                      s3 = peg$currPos;
                      s4 = [];
                      s5 = peg$parseWS();
                      while (s5 !== peg$FAILED) {
                        s4.push(s5);
                        s5 = peg$parseWS();
                      }
                      if (s4 !== peg$FAILED) {
                        if (input.charCodeAt(peg$currPos) === 78) {
                          s5 = peg$c306;
                          peg$currPos++;
                        } else {
                          s5 = peg$FAILED;
                          if (peg$silentFails === 0) { peg$fail(peg$c307); }
                        }
                        if (s5 === peg$FAILED) {
                          if (input.charCodeAt(peg$currPos) === 110) {
                            s5 = peg$c308;
                            peg$currPos++;
                          } else {
                            s5 = peg$FAILED;
                            if (peg$silentFails === 0) { peg$fail(peg$c309); }
                          }
                        }
                        if (s5 !== peg$FAILED) {
                          if (input.charCodeAt(peg$currPos) === 79) {
                            s6 = peg$c310;
                            peg$currPos++;
                          } else {
                            s6 = peg$FAILED;
                            if (peg$silentFails === 0) { peg$fail(peg$c311); }
                          }
                          if (s6 === peg$FAILED) {
                            if (input.charCodeAt(peg$currPos) === 111) {
                              s6 = peg$c312;
                              peg$currPos++;
                            } else {
                              s6 = peg$FAILED;
                              if (peg$silentFails === 0) { peg$fail(peg$c313); }
                            }
                          }
                          if (s6 !== peg$FAILED) {
                            if (input.charCodeAt(peg$currPos) === 84) {
                              s7 = peg$c314;
                              peg$currPos++;
                            } else {
                              s7 = peg$FAILED;
                              if (peg$silentFails === 0) { peg$fail(peg$c315); }
                            }
                            if (s7 === peg$FAILED) {
                              if (input.charCodeAt(peg$currPos) === 116) {
                                s7 = peg$c316;
                                peg$currPos++;
                              } else {
                                s7 = peg$FAILED;
                                if (peg$silentFails === 0) { peg$fail(peg$c317); }
                              }
                            }
                            if (s7 !== peg$FAILED) {
                              s8 = [];
                              s9 = peg$parseWS();
                              while (s9 !== peg$FAILED) {
                                s8.push(s9);
                                s9 = peg$parseWS();
                              }
                              if (s8 !== peg$FAILED) {
                                if (input.charCodeAt(peg$currPos) === 73) {
                                  s9 = peg$c302;
                                  peg$currPos++;
                                } else {
                                  s9 = peg$FAILED;
                                  if (peg$silentFails === 0) { peg$fail(peg$c303); }
                                }
                                if (s9 === peg$FAILED) {
                                  if (input.charCodeAt(peg$currPos) === 105) {
                                    s9 = peg$c304;
                                    peg$currPos++;
                                  } else {
                                    s9 = peg$FAILED;
                                    if (peg$silentFails === 0) { peg$fail(peg$c305); }
                                  }
                                }
                                if (s9 !== peg$FAILED) {
                                  if (input.charCodeAt(peg$currPos) === 78) {
                                    s10 = peg$c306;
                                    peg$currPos++;
                                  } else {
                                    s10 = peg$FAILED;
                                    if (peg$silentFails === 0) { peg$fail(peg$c307); }
                                  }
                                  if (s10 === peg$FAILED) {
                                    if (input.charCodeAt(peg$currPos) === 110) {
                                      s10 = peg$c308;
                                      peg$currPos++;
                                    } else {
                                      s10 = peg$FAILED;
                                      if (peg$silentFails === 0) { peg$fail(peg$c309); }
                                    }
                                  }
                                  if (s10 !== peg$FAILED) {
                                    s11 = [];
                                    s12 = peg$parseWS();
                                    while (s12 !== peg$FAILED) {
                                      s11.push(s12);
                                      s12 = peg$parseWS();
                                    }
                                    if (s11 !== peg$FAILED) {
                                      s12 = peg$parseExpressionList();
                                      if (s12 !== peg$FAILED) {
                                        s4 = [s4, s5, s6, s7, s8, s9, s10, s11, s12];
                                        s3 = s4;
                                      } else {
                                        peg$currPos = s3;
                                        s3 = peg$FAILED;
                                      }
                                    } else {
                                      peg$currPos = s3;
                                      s3 = peg$FAILED;
                                    }
                                  } else {
                                    peg$currPos = s3;
                                    s3 = peg$FAILED;
                                  }
                                } else {
                                  peg$currPos = s3;
                                  s3 = peg$FAILED;
                                }
                              } else {
                                peg$currPos = s3;
                                s3 = peg$FAILED;
                              }
                            } else {
                              peg$currPos = s3;
                              s3 = peg$FAILED;
                            }
                          } else {
                            peg$currPos = s3;
                            s3 = peg$FAILED;
                          }
                        } else {
                          peg$currPos = s3;
                          s3 = peg$FAILED;
                        }
                      } else {
                        peg$currPos = s3;
                        s3 = peg$FAILED;
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
      if (s2 !== peg$FAILED) {
        peg$savedPos = s0;
        s1 = peg$c318(s1, s2);
        s0 = s1;
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }

    return s0;
  }

  function peg$parseAdditiveExpression() {
    var s0, s1, s2, s3, s4, s5, s6, s7, s8, s9;

    s0 = peg$currPos;
    s1 = peg$parseMultiplicativeExpression();
    if (s1 !== peg$FAILED) {
      s2 = [];
      s3 = peg$currPos;
      s4 = [];
      s5 = peg$parseWS();
      while (s5 !== peg$FAILED) {
        s4.push(s5);
        s5 = peg$parseWS();
      }
      if (s4 !== peg$FAILED) {
        if (input.charCodeAt(peg$currPos) === 43) {
          s5 = peg$c268;
          peg$currPos++;
        } else {
          s5 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c269); }
        }
        if (s5 !== peg$FAILED) {
          s6 = [];
          s7 = peg$parseWS();
          while (s7 !== peg$FAILED) {
            s6.push(s7);
            s7 = peg$parseWS();
          }
          if (s6 !== peg$FAILED) {
            s7 = peg$parseMultiplicativeExpression();
            if (s7 !== peg$FAILED) {
              s4 = [s4, s5, s6, s7];
              s3 = s4;
            } else {
              peg$currPos = s3;
              s3 = peg$FAILED;
            }
          } else {
            peg$currPos = s3;
            s3 = peg$FAILED;
          }
        } else {
          peg$currPos = s3;
          s3 = peg$FAILED;
        }
      } else {
        peg$currPos = s3;
        s3 = peg$FAILED;
      }
      if (s3 === peg$FAILED) {
        s3 = peg$currPos;
        s4 = [];
        s5 = peg$parseWS();
        while (s5 !== peg$FAILED) {
          s4.push(s5);
          s5 = peg$parseWS();
        }
        if (s4 !== peg$FAILED) {
          if (input.charCodeAt(peg$currPos) === 45) {
            s5 = peg$c319;
            peg$currPos++;
          } else {
            s5 = peg$FAILED;
            if (peg$silentFails === 0) { peg$fail(peg$c320); }
          }
          if (s5 !== peg$FAILED) {
            s6 = [];
            s7 = peg$parseWS();
            while (s7 !== peg$FAILED) {
              s6.push(s7);
              s7 = peg$parseWS();
            }
            if (s6 !== peg$FAILED) {
              s7 = peg$parseMultiplicativeExpression();
              if (s7 !== peg$FAILED) {
                s4 = [s4, s5, s6, s7];
                s3 = s4;
              } else {
                peg$currPos = s3;
                s3 = peg$FAILED;
              }
            } else {
              peg$currPos = s3;
              s3 = peg$FAILED;
            }
          } else {
            peg$currPos = s3;
            s3 = peg$FAILED;
          }
        } else {
          peg$currPos = s3;
          s3 = peg$FAILED;
        }
        if (s3 === peg$FAILED) {
          s3 = peg$currPos;
          s4 = peg$parseNumericLiteralNegative();
          if (s4 === peg$FAILED) {
            s4 = peg$parseNumericLiteralNegative();
          }
          if (s4 !== peg$FAILED) {
            s5 = peg$currPos;
            s6 = [];
            s7 = peg$parseWS();
            while (s7 !== peg$FAILED) {
              s6.push(s7);
              s7 = peg$parseWS();
            }
            if (s6 !== peg$FAILED) {
              if (input.charCodeAt(peg$currPos) === 42) {
                s7 = peg$c35;
                peg$currPos++;
              } else {
                s7 = peg$FAILED;
                if (peg$silentFails === 0) { peg$fail(peg$c36); }
              }
              if (s7 !== peg$FAILED) {
                s8 = [];
                s9 = peg$parseWS();
                while (s9 !== peg$FAILED) {
                  s8.push(s9);
                  s9 = peg$parseWS();
                }
                if (s8 !== peg$FAILED) {
                  s9 = peg$parseUnaryExpression();
                  if (s9 !== peg$FAILED) {
                    s6 = [s6, s7, s8, s9];
                    s5 = s6;
                  } else {
                    peg$currPos = s5;
                    s5 = peg$FAILED;
                  }
                } else {
                  peg$currPos = s5;
                  s5 = peg$FAILED;
                }
              } else {
                peg$currPos = s5;
                s5 = peg$FAILED;
              }
            } else {
              peg$currPos = s5;
              s5 = peg$FAILED;
            }
            if (s5 === peg$FAILED) {
              s5 = peg$currPos;
              s6 = [];
              s7 = peg$parseWS();
              while (s7 !== peg$FAILED) {
                s6.push(s7);
                s7 = peg$parseWS();
              }
              if (s6 !== peg$FAILED) {
                if (input.charCodeAt(peg$currPos) === 47) {
                  s7 = peg$c259;
                  peg$currPos++;
                } else {
                  s7 = peg$FAILED;
                  if (peg$silentFails === 0) { peg$fail(peg$c260); }
                }
                if (s7 !== peg$FAILED) {
                  s8 = [];
                  s9 = peg$parseWS();
                  while (s9 !== peg$FAILED) {
                    s8.push(s9);
                    s9 = peg$parseWS();
                  }
                  if (s8 !== peg$FAILED) {
                    s9 = peg$parseUnaryExpression();
                    if (s9 !== peg$FAILED) {
                      s6 = [s6, s7, s8, s9];
                      s5 = s6;
                    } else {
                      peg$currPos = s5;
                      s5 = peg$FAILED;
                    }
                  } else {
                    peg$currPos = s5;
                    s5 = peg$FAILED;
                  }
                } else {
                  peg$currPos = s5;
                  s5 = peg$FAILED;
                }
              } else {
                peg$currPos = s5;
                s5 = peg$FAILED;
              }
            }
            if (s5 === peg$FAILED) {
              s5 = null;
            }
            if (s5 !== peg$FAILED) {
              s4 = [s4, s5];
              s3 = s4;
            } else {
              peg$currPos = s3;
              s3 = peg$FAILED;
            }
          } else {
            peg$currPos = s3;
            s3 = peg$FAILED;
          }
        }
      }
      while (s3 !== peg$FAILED) {
        s2.push(s3);
        s3 = peg$currPos;
        s4 = [];
        s5 = peg$parseWS();
        while (s5 !== peg$FAILED) {
          s4.push(s5);
          s5 = peg$parseWS();
        }
        if (s4 !== peg$FAILED) {
          if (input.charCodeAt(peg$currPos) === 43) {
            s5 = peg$c268;
            peg$currPos++;
          } else {
            s5 = peg$FAILED;
            if (peg$silentFails === 0) { peg$fail(peg$c269); }
          }
          if (s5 !== peg$FAILED) {
            s6 = [];
            s7 = peg$parseWS();
            while (s7 !== peg$FAILED) {
              s6.push(s7);
              s7 = peg$parseWS();
            }
            if (s6 !== peg$FAILED) {
              s7 = peg$parseMultiplicativeExpression();
              if (s7 !== peg$FAILED) {
                s4 = [s4, s5, s6, s7];
                s3 = s4;
              } else {
                peg$currPos = s3;
                s3 = peg$FAILED;
              }
            } else {
              peg$currPos = s3;
              s3 = peg$FAILED;
            }
          } else {
            peg$currPos = s3;
            s3 = peg$FAILED;
          }
        } else {
          peg$currPos = s3;
          s3 = peg$FAILED;
        }
        if (s3 === peg$FAILED) {
          s3 = peg$currPos;
          s4 = [];
          s5 = peg$parseWS();
          while (s5 !== peg$FAILED) {
            s4.push(s5);
            s5 = peg$parseWS();
          }
          if (s4 !== peg$FAILED) {
            if (input.charCodeAt(peg$currPos) === 45) {
              s5 = peg$c319;
              peg$currPos++;
            } else {
              s5 = peg$FAILED;
              if (peg$silentFails === 0) { peg$fail(peg$c320); }
            }
            if (s5 !== peg$FAILED) {
              s6 = [];
              s7 = peg$parseWS();
              while (s7 !== peg$FAILED) {
                s6.push(s7);
                s7 = peg$parseWS();
              }
              if (s6 !== peg$FAILED) {
                s7 = peg$parseMultiplicativeExpression();
                if (s7 !== peg$FAILED) {
                  s4 = [s4, s5, s6, s7];
                  s3 = s4;
                } else {
                  peg$currPos = s3;
                  s3 = peg$FAILED;
                }
              } else {
                peg$currPos = s3;
                s3 = peg$FAILED;
              }
            } else {
              peg$currPos = s3;
              s3 = peg$FAILED;
            }
          } else {
            peg$currPos = s3;
            s3 = peg$FAILED;
          }
          if (s3 === peg$FAILED) {
            s3 = peg$currPos;
            s4 = peg$parseNumericLiteralNegative();
            if (s4 === peg$FAILED) {
              s4 = peg$parseNumericLiteralNegative();
            }
            if (s4 !== peg$FAILED) {
              s5 = peg$currPos;
              s6 = [];
              s7 = peg$parseWS();
              while (s7 !== peg$FAILED) {
                s6.push(s7);
                s7 = peg$parseWS();
              }
              if (s6 !== peg$FAILED) {
                if (input.charCodeAt(peg$currPos) === 42) {
                  s7 = peg$c35;
                  peg$currPos++;
                } else {
                  s7 = peg$FAILED;
                  if (peg$silentFails === 0) { peg$fail(peg$c36); }
                }
                if (s7 !== peg$FAILED) {
                  s8 = [];
                  s9 = peg$parseWS();
                  while (s9 !== peg$FAILED) {
                    s8.push(s9);
                    s9 = peg$parseWS();
                  }
                  if (s8 !== peg$FAILED) {
                    s9 = peg$parseUnaryExpression();
                    if (s9 !== peg$FAILED) {
                      s6 = [s6, s7, s8, s9];
                      s5 = s6;
                    } else {
                      peg$currPos = s5;
                      s5 = peg$FAILED;
                    }
                  } else {
                    peg$currPos = s5;
                    s5 = peg$FAILED;
                  }
                } else {
                  peg$currPos = s5;
                  s5 = peg$FAILED;
                }
              } else {
                peg$currPos = s5;
                s5 = peg$FAILED;
              }
              if (s5 === peg$FAILED) {
                s5 = peg$currPos;
                s6 = [];
                s7 = peg$parseWS();
                while (s7 !== peg$FAILED) {
                  s6.push(s7);
                  s7 = peg$parseWS();
                }
                if (s6 !== peg$FAILED) {
                  if (input.charCodeAt(peg$currPos) === 47) {
                    s7 = peg$c259;
                    peg$currPos++;
                  } else {
                    s7 = peg$FAILED;
                    if (peg$silentFails === 0) { peg$fail(peg$c260); }
                  }
                  if (s7 !== peg$FAILED) {
                    s8 = [];
                    s9 = peg$parseWS();
                    while (s9 !== peg$FAILED) {
                      s8.push(s9);
                      s9 = peg$parseWS();
                    }
                    if (s8 !== peg$FAILED) {
                      s9 = peg$parseUnaryExpression();
                      if (s9 !== peg$FAILED) {
                        s6 = [s6, s7, s8, s9];
                        s5 = s6;
                      } else {
                        peg$currPos = s5;
                        s5 = peg$FAILED;
                      }
                    } else {
                      peg$currPos = s5;
                      s5 = peg$FAILED;
                    }
                  } else {
                    peg$currPos = s5;
                    s5 = peg$FAILED;
                  }
                } else {
                  peg$currPos = s5;
                  s5 = peg$FAILED;
                }
              }
              if (s5 === peg$FAILED) {
                s5 = null;
              }
              if (s5 !== peg$FAILED) {
                s4 = [s4, s5];
                s3 = s4;
              } else {
                peg$currPos = s3;
                s3 = peg$FAILED;
              }
            } else {
              peg$currPos = s3;
              s3 = peg$FAILED;
            }
          }
        }
      }
      if (s2 !== peg$FAILED) {
        peg$savedPos = s0;
        s1 = peg$c321(s1, s2);
        s0 = s1;
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }

    return s0;
  }

  function peg$parseMultiplicativeExpression() {
    var s0, s1, s2, s3, s4, s5, s6, s7;

    s0 = peg$currPos;
    s1 = peg$parseUnaryExpression();
    if (s1 !== peg$FAILED) {
      s2 = [];
      s3 = peg$currPos;
      s4 = [];
      s5 = peg$parseWS();
      while (s5 !== peg$FAILED) {
        s4.push(s5);
        s5 = peg$parseWS();
      }
      if (s4 !== peg$FAILED) {
        if (input.charCodeAt(peg$currPos) === 42) {
          s5 = peg$c35;
          peg$currPos++;
        } else {
          s5 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c36); }
        }
        if (s5 !== peg$FAILED) {
          s6 = [];
          s7 = peg$parseWS();
          while (s7 !== peg$FAILED) {
            s6.push(s7);
            s7 = peg$parseWS();
          }
          if (s6 !== peg$FAILED) {
            s7 = peg$parseUnaryExpression();
            if (s7 !== peg$FAILED) {
              s4 = [s4, s5, s6, s7];
              s3 = s4;
            } else {
              peg$currPos = s3;
              s3 = peg$FAILED;
            }
          } else {
            peg$currPos = s3;
            s3 = peg$FAILED;
          }
        } else {
          peg$currPos = s3;
          s3 = peg$FAILED;
        }
      } else {
        peg$currPos = s3;
        s3 = peg$FAILED;
      }
      if (s3 === peg$FAILED) {
        s3 = peg$currPos;
        s4 = [];
        s5 = peg$parseWS();
        while (s5 !== peg$FAILED) {
          s4.push(s5);
          s5 = peg$parseWS();
        }
        if (s4 !== peg$FAILED) {
          if (input.charCodeAt(peg$currPos) === 47) {
            s5 = peg$c259;
            peg$currPos++;
          } else {
            s5 = peg$FAILED;
            if (peg$silentFails === 0) { peg$fail(peg$c260); }
          }
          if (s5 !== peg$FAILED) {
            s6 = [];
            s7 = peg$parseWS();
            while (s7 !== peg$FAILED) {
              s6.push(s7);
              s7 = peg$parseWS();
            }
            if (s6 !== peg$FAILED) {
              s7 = peg$parseUnaryExpression();
              if (s7 !== peg$FAILED) {
                s4 = [s4, s5, s6, s7];
                s3 = s4;
              } else {
                peg$currPos = s3;
                s3 = peg$FAILED;
              }
            } else {
              peg$currPos = s3;
              s3 = peg$FAILED;
            }
          } else {
            peg$currPos = s3;
            s3 = peg$FAILED;
          }
        } else {
          peg$currPos = s3;
          s3 = peg$FAILED;
        }
      }
      while (s3 !== peg$FAILED) {
        s2.push(s3);
        s3 = peg$currPos;
        s4 = [];
        s5 = peg$parseWS();
        while (s5 !== peg$FAILED) {
          s4.push(s5);
          s5 = peg$parseWS();
        }
        if (s4 !== peg$FAILED) {
          if (input.charCodeAt(peg$currPos) === 42) {
            s5 = peg$c35;
            peg$currPos++;
          } else {
            s5 = peg$FAILED;
            if (peg$silentFails === 0) { peg$fail(peg$c36); }
          }
          if (s5 !== peg$FAILED) {
            s6 = [];
            s7 = peg$parseWS();
            while (s7 !== peg$FAILED) {
              s6.push(s7);
              s7 = peg$parseWS();
            }
            if (s6 !== peg$FAILED) {
              s7 = peg$parseUnaryExpression();
              if (s7 !== peg$FAILED) {
                s4 = [s4, s5, s6, s7];
                s3 = s4;
              } else {
                peg$currPos = s3;
                s3 = peg$FAILED;
              }
            } else {
              peg$currPos = s3;
              s3 = peg$FAILED;
            }
          } else {
            peg$currPos = s3;
            s3 = peg$FAILED;
          }
        } else {
          peg$currPos = s3;
          s3 = peg$FAILED;
        }
        if (s3 === peg$FAILED) {
          s3 = peg$currPos;
          s4 = [];
          s5 = peg$parseWS();
          while (s5 !== peg$FAILED) {
            s4.push(s5);
            s5 = peg$parseWS();
          }
          if (s4 !== peg$FAILED) {
            if (input.charCodeAt(peg$currPos) === 47) {
              s5 = peg$c259;
              peg$currPos++;
            } else {
              s5 = peg$FAILED;
              if (peg$silentFails === 0) { peg$fail(peg$c260); }
            }
            if (s5 !== peg$FAILED) {
              s6 = [];
              s7 = peg$parseWS();
              while (s7 !== peg$FAILED) {
                s6.push(s7);
                s7 = peg$parseWS();
              }
              if (s6 !== peg$FAILED) {
                s7 = peg$parseUnaryExpression();
                if (s7 !== peg$FAILED) {
                  s4 = [s4, s5, s6, s7];
                  s3 = s4;
                } else {
                  peg$currPos = s3;
                  s3 = peg$FAILED;
                }
              } else {
                peg$currPos = s3;
                s3 = peg$FAILED;
              }
            } else {
              peg$currPos = s3;
              s3 = peg$FAILED;
            }
          } else {
            peg$currPos = s3;
            s3 = peg$FAILED;
          }
        }
      }
      if (s2 !== peg$FAILED) {
        peg$savedPos = s0;
        s1 = peg$c322(s1, s2);
        s0 = s1;
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }

    return s0;
  }

  function peg$parseUnaryExpression() {
    var s0, s1, s2, s3;

    s0 = peg$currPos;
    if (input.charCodeAt(peg$currPos) === 33) {
      s1 = peg$c272;
      peg$currPos++;
    } else {
      s1 = peg$FAILED;
      if (peg$silentFails === 0) { peg$fail(peg$c273); }
    }
    if (s1 !== peg$FAILED) {
      s2 = [];
      s3 = peg$parseWS();
      while (s3 !== peg$FAILED) {
        s2.push(s3);
        s3 = peg$parseWS();
      }
      if (s2 !== peg$FAILED) {
        s3 = peg$parsePrimaryExpression();
        if (s3 !== peg$FAILED) {
          peg$savedPos = s0;
          s1 = peg$c323(s3);
          s0 = s1;
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }
    if (s0 === peg$FAILED) {
      s0 = peg$currPos;
      if (input.charCodeAt(peg$currPos) === 43) {
        s1 = peg$c268;
        peg$currPos++;
      } else {
        s1 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c269); }
      }
      if (s1 !== peg$FAILED) {
        s2 = [];
        s3 = peg$parseWS();
        while (s3 !== peg$FAILED) {
          s2.push(s3);
          s3 = peg$parseWS();
        }
        if (s2 !== peg$FAILED) {
          s3 = peg$parsePrimaryExpression();
          if (s3 !== peg$FAILED) {
            peg$savedPos = s0;
            s1 = peg$c324(s3);
            s0 = s1;
          } else {
            peg$currPos = s0;
            s0 = peg$FAILED;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
      if (s0 === peg$FAILED) {
        s0 = peg$currPos;
        if (input.charCodeAt(peg$currPos) === 45) {
          s1 = peg$c319;
          peg$currPos++;
        } else {
          s1 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c320); }
        }
        if (s1 !== peg$FAILED) {
          s2 = [];
          s3 = peg$parseWS();
          while (s3 !== peg$FAILED) {
            s2.push(s3);
            s3 = peg$parseWS();
          }
          if (s2 !== peg$FAILED) {
            s3 = peg$parsePrimaryExpression();
            if (s3 !== peg$FAILED) {
              peg$savedPos = s0;
              s1 = peg$c325(s3);
              s0 = s1;
            } else {
              peg$currPos = s0;
              s0 = peg$FAILED;
            }
          } else {
            peg$currPos = s0;
            s0 = peg$FAILED;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
        if (s0 === peg$FAILED) {
          s0 = peg$parsePrimaryExpression();
        }
      }
    }

    return s0;
  }

  function peg$parsePrimaryExpression() {
    var s0, s1;

    s0 = peg$parseBrackettedExpression();
    if (s0 === peg$FAILED) {
      s0 = peg$parseBuiltInCall();
      if (s0 === peg$FAILED) {
        s0 = peg$parseIRIrefOrFunction();
        if (s0 === peg$FAILED) {
          s0 = peg$currPos;
          s1 = peg$parseRDFLiteral();
          if (s1 !== peg$FAILED) {
            peg$savedPos = s0;
            s1 = peg$c326(s1);
          }
          s0 = s1;
          if (s0 === peg$FAILED) {
            s0 = peg$currPos;
            s1 = peg$parseNumericLiteral();
            if (s1 !== peg$FAILED) {
              peg$savedPos = s0;
              s1 = peg$c327(s1);
            }
            s0 = s1;
            if (s0 === peg$FAILED) {
              s0 = peg$currPos;
              s1 = peg$parseBooleanLiteral();
              if (s1 !== peg$FAILED) {
                peg$savedPos = s0;
                s1 = peg$c328(s1);
              }
              s0 = s1;
              if (s0 === peg$FAILED) {
                s0 = peg$parseAggregate();
                if (s0 === peg$FAILED) {
                  s0 = peg$currPos;
                  s1 = peg$parseVar();
                  if (s1 !== peg$FAILED) {
                    peg$savedPos = s0;
                    s1 = peg$c329(s1);
                  }
                  s0 = s1;
                }
              }
            }
          }
        }
      }
    }

    return s0;
  }

  function peg$parseBrackettedExpression() {
    var s0, s1, s2, s3, s4, s5;

    s0 = peg$currPos;
    if (input.charCodeAt(peg$currPos) === 40) {
      s1 = peg$c27;
      peg$currPos++;
    } else {
      s1 = peg$FAILED;
      if (peg$silentFails === 0) { peg$fail(peg$c28); }
    }
    if (s1 !== peg$FAILED) {
      s2 = [];
      s3 = peg$parseWS();
      while (s3 !== peg$FAILED) {
        s2.push(s3);
        s3 = peg$parseWS();
      }
      if (s2 !== peg$FAILED) {
        s3 = peg$parseConditionalOrExpression();
        if (s3 !== peg$FAILED) {
          s4 = [];
          s5 = peg$parseWS();
          while (s5 !== peg$FAILED) {
            s4.push(s5);
            s5 = peg$parseWS();
          }
          if (s4 !== peg$FAILED) {
            if (input.charCodeAt(peg$currPos) === 41) {
              s5 = peg$c33;
              peg$currPos++;
            } else {
              s5 = peg$FAILED;
              if (peg$silentFails === 0) { peg$fail(peg$c34); }
            }
            if (s5 !== peg$FAILED) {
              peg$savedPos = s0;
              s1 = peg$c330(s3);
              s0 = s1;
            } else {
              peg$currPos = s0;
              s0 = peg$FAILED;
            }
          } else {
            peg$currPos = s0;
            s0 = peg$FAILED;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }

    return s0;
  }

  function peg$parseBuiltInCall() {
    var s0, s1, s2, s3, s4, s5, s6, s7, s8, s9, s10, s11, s12, s13, s14, s15;

    s0 = peg$currPos;
    if (input.substr(peg$currPos, 3) === peg$c331) {
      s1 = peg$c331;
      peg$currPos += 3;
    } else {
      s1 = peg$FAILED;
      if (peg$silentFails === 0) { peg$fail(peg$c332); }
    }
    if (s1 === peg$FAILED) {
      if (input.substr(peg$currPos, 3) === peg$c333) {
        s1 = peg$c333;
        peg$currPos += 3;
      } else {
        s1 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c334); }
      }
    }
    if (s1 !== peg$FAILED) {
      s2 = [];
      s3 = peg$parseWS();
      while (s3 !== peg$FAILED) {
        s2.push(s3);
        s3 = peg$parseWS();
      }
      if (s2 !== peg$FAILED) {
        if (input.charCodeAt(peg$currPos) === 40) {
          s3 = peg$c27;
          peg$currPos++;
        } else {
          s3 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c28); }
        }
        if (s3 !== peg$FAILED) {
          s4 = [];
          s5 = peg$parseWS();
          while (s5 !== peg$FAILED) {
            s4.push(s5);
            s5 = peg$parseWS();
          }
          if (s4 !== peg$FAILED) {
            s5 = peg$parseConditionalOrExpression();
            if (s5 !== peg$FAILED) {
              s6 = [];
              s7 = peg$parseWS();
              while (s7 !== peg$FAILED) {
                s6.push(s7);
                s7 = peg$parseWS();
              }
              if (s6 !== peg$FAILED) {
                if (input.charCodeAt(peg$currPos) === 41) {
                  s7 = peg$c33;
                  peg$currPos++;
                } else {
                  s7 = peg$FAILED;
                  if (peg$silentFails === 0) { peg$fail(peg$c34); }
                }
                if (s7 !== peg$FAILED) {
                  peg$savedPos = s0;
                  s1 = peg$c335(s5);
                  s0 = s1;
                } else {
                  peg$currPos = s0;
                  s0 = peg$FAILED;
                }
              } else {
                peg$currPos = s0;
                s0 = peg$FAILED;
              }
            } else {
              peg$currPos = s0;
              s0 = peg$FAILED;
            }
          } else {
            peg$currPos = s0;
            s0 = peg$FAILED;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }
    if (s0 === peg$FAILED) {
      s0 = peg$currPos;
      if (input.substr(peg$currPos, 4) === peg$c336) {
        s1 = peg$c336;
        peg$currPos += 4;
      } else {
        s1 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c337); }
      }
      if (s1 === peg$FAILED) {
        if (input.substr(peg$currPos, 4) === peg$c338) {
          s1 = peg$c338;
          peg$currPos += 4;
        } else {
          s1 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c339); }
        }
      }
      if (s1 !== peg$FAILED) {
        s2 = [];
        s3 = peg$parseWS();
        while (s3 !== peg$FAILED) {
          s2.push(s3);
          s3 = peg$parseWS();
        }
        if (s2 !== peg$FAILED) {
          if (input.charCodeAt(peg$currPos) === 40) {
            s3 = peg$c27;
            peg$currPos++;
          } else {
            s3 = peg$FAILED;
            if (peg$silentFails === 0) { peg$fail(peg$c28); }
          }
          if (s3 !== peg$FAILED) {
            s4 = [];
            s5 = peg$parseWS();
            while (s5 !== peg$FAILED) {
              s4.push(s5);
              s5 = peg$parseWS();
            }
            if (s4 !== peg$FAILED) {
              s5 = peg$parseConditionalOrExpression();
              if (s5 !== peg$FAILED) {
                s6 = [];
                s7 = peg$parseWS();
                while (s7 !== peg$FAILED) {
                  s6.push(s7);
                  s7 = peg$parseWS();
                }
                if (s6 !== peg$FAILED) {
                  if (input.charCodeAt(peg$currPos) === 41) {
                    s7 = peg$c33;
                    peg$currPos++;
                  } else {
                    s7 = peg$FAILED;
                    if (peg$silentFails === 0) { peg$fail(peg$c34); }
                  }
                  if (s7 !== peg$FAILED) {
                    peg$savedPos = s0;
                    s1 = peg$c340(s5);
                    s0 = s1;
                  } else {
                    peg$currPos = s0;
                    s0 = peg$FAILED;
                  }
                } else {
                  peg$currPos = s0;
                  s0 = peg$FAILED;
                }
              } else {
                peg$currPos = s0;
                s0 = peg$FAILED;
              }
            } else {
              peg$currPos = s0;
              s0 = peg$FAILED;
            }
          } else {
            peg$currPos = s0;
            s0 = peg$FAILED;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
      if (s0 === peg$FAILED) {
        s0 = peg$currPos;
        if (input.substr(peg$currPos, 11) === peg$c341) {
          s1 = peg$c341;
          peg$currPos += 11;
        } else {
          s1 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c342); }
        }
        if (s1 === peg$FAILED) {
          if (input.substr(peg$currPos, 11) === peg$c343) {
            s1 = peg$c343;
            peg$currPos += 11;
          } else {
            s1 = peg$FAILED;
            if (peg$silentFails === 0) { peg$fail(peg$c344); }
          }
        }
        if (s1 !== peg$FAILED) {
          s2 = [];
          s3 = peg$parseWS();
          while (s3 !== peg$FAILED) {
            s2.push(s3);
            s3 = peg$parseWS();
          }
          if (s2 !== peg$FAILED) {
            if (input.charCodeAt(peg$currPos) === 40) {
              s3 = peg$c27;
              peg$currPos++;
            } else {
              s3 = peg$FAILED;
              if (peg$silentFails === 0) { peg$fail(peg$c28); }
            }
            if (s3 !== peg$FAILED) {
              s4 = [];
              s5 = peg$parseWS();
              while (s5 !== peg$FAILED) {
                s4.push(s5);
                s5 = peg$parseWS();
              }
              if (s4 !== peg$FAILED) {
                s5 = peg$parseConditionalOrExpression();
                if (s5 !== peg$FAILED) {
                  s6 = [];
                  s7 = peg$parseWS();
                  while (s7 !== peg$FAILED) {
                    s6.push(s7);
                    s7 = peg$parseWS();
                  }
                  if (s6 !== peg$FAILED) {
                    if (input.charCodeAt(peg$currPos) === 44) {
                      s7 = peg$c239;
                      peg$currPos++;
                    } else {
                      s7 = peg$FAILED;
                      if (peg$silentFails === 0) { peg$fail(peg$c240); }
                    }
                    if (s7 !== peg$FAILED) {
                      s8 = [];
                      s9 = peg$parseWS();
                      while (s9 !== peg$FAILED) {
                        s8.push(s9);
                        s9 = peg$parseWS();
                      }
                      if (s8 !== peg$FAILED) {
                        s9 = peg$parseConditionalOrExpression();
                        if (s9 !== peg$FAILED) {
                          s10 = [];
                          s11 = peg$parseWS();
                          while (s11 !== peg$FAILED) {
                            s10.push(s11);
                            s11 = peg$parseWS();
                          }
                          if (s10 !== peg$FAILED) {
                            if (input.charCodeAt(peg$currPos) === 41) {
                              s11 = peg$c33;
                              peg$currPos++;
                            } else {
                              s11 = peg$FAILED;
                              if (peg$silentFails === 0) { peg$fail(peg$c34); }
                            }
                            if (s11 !== peg$FAILED) {
                              peg$savedPos = s0;
                              s1 = peg$c345(s5, s9);
                              s0 = s1;
                            } else {
                              peg$currPos = s0;
                              s0 = peg$FAILED;
                            }
                          } else {
                            peg$currPos = s0;
                            s0 = peg$FAILED;
                          }
                        } else {
                          peg$currPos = s0;
                          s0 = peg$FAILED;
                        }
                      } else {
                        peg$currPos = s0;
                        s0 = peg$FAILED;
                      }
                    } else {
                      peg$currPos = s0;
                      s0 = peg$FAILED;
                    }
                  } else {
                    peg$currPos = s0;
                    s0 = peg$FAILED;
                  }
                } else {
                  peg$currPos = s0;
                  s0 = peg$FAILED;
                }
              } else {
                peg$currPos = s0;
                s0 = peg$FAILED;
              }
            } else {
              peg$currPos = s0;
              s0 = peg$FAILED;
            }
          } else {
            peg$currPos = s0;
            s0 = peg$FAILED;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
        if (s0 === peg$FAILED) {
          s0 = peg$currPos;
          if (input.substr(peg$currPos, 8) === peg$c346) {
            s1 = peg$c346;
            peg$currPos += 8;
          } else {
            s1 = peg$FAILED;
            if (peg$silentFails === 0) { peg$fail(peg$c347); }
          }
          if (s1 === peg$FAILED) {
            if (input.substr(peg$currPos, 8) === peg$c348) {
              s1 = peg$c348;
              peg$currPos += 8;
            } else {
              s1 = peg$FAILED;
              if (peg$silentFails === 0) { peg$fail(peg$c349); }
            }
          }
          if (s1 !== peg$FAILED) {
            s2 = [];
            s3 = peg$parseWS();
            while (s3 !== peg$FAILED) {
              s2.push(s3);
              s3 = peg$parseWS();
            }
            if (s2 !== peg$FAILED) {
              if (input.charCodeAt(peg$currPos) === 40) {
                s3 = peg$c27;
                peg$currPos++;
              } else {
                s3 = peg$FAILED;
                if (peg$silentFails === 0) { peg$fail(peg$c28); }
              }
              if (s3 !== peg$FAILED) {
                s4 = [];
                s5 = peg$parseWS();
                while (s5 !== peg$FAILED) {
                  s4.push(s5);
                  s5 = peg$parseWS();
                }
                if (s4 !== peg$FAILED) {
                  s5 = peg$parseConditionalOrExpression();
                  if (s5 !== peg$FAILED) {
                    s6 = [];
                    s7 = peg$parseWS();
                    while (s7 !== peg$FAILED) {
                      s6.push(s7);
                      s7 = peg$parseWS();
                    }
                    if (s6 !== peg$FAILED) {
                      if (input.charCodeAt(peg$currPos) === 41) {
                        s7 = peg$c33;
                        peg$currPos++;
                      } else {
                        s7 = peg$FAILED;
                        if (peg$silentFails === 0) { peg$fail(peg$c34); }
                      }
                      if (s7 !== peg$FAILED) {
                        peg$savedPos = s0;
                        s1 = peg$c350(s5);
                        s0 = s1;
                      } else {
                        peg$currPos = s0;
                        s0 = peg$FAILED;
                      }
                    } else {
                      peg$currPos = s0;
                      s0 = peg$FAILED;
                    }
                  } else {
                    peg$currPos = s0;
                    s0 = peg$FAILED;
                  }
                } else {
                  peg$currPos = s0;
                  s0 = peg$FAILED;
                }
              } else {
                peg$currPos = s0;
                s0 = peg$FAILED;
              }
            } else {
              peg$currPos = s0;
              s0 = peg$FAILED;
            }
          } else {
            peg$currPos = s0;
            s0 = peg$FAILED;
          }
          if (s0 === peg$FAILED) {
            s0 = peg$currPos;
            if (input.substr(peg$currPos, 5) === peg$c351) {
              s1 = peg$c351;
              peg$currPos += 5;
            } else {
              s1 = peg$FAILED;
              if (peg$silentFails === 0) { peg$fail(peg$c352); }
            }
            if (s1 === peg$FAILED) {
              if (input.substr(peg$currPos, 5) === peg$c353) {
                s1 = peg$c353;
                peg$currPos += 5;
              } else {
                s1 = peg$FAILED;
                if (peg$silentFails === 0) { peg$fail(peg$c354); }
              }
            }
            if (s1 !== peg$FAILED) {
              s2 = [];
              s3 = peg$parseWS();
              while (s3 !== peg$FAILED) {
                s2.push(s3);
                s3 = peg$parseWS();
              }
              if (s2 !== peg$FAILED) {
                if (input.charCodeAt(peg$currPos) === 40) {
                  s3 = peg$c27;
                  peg$currPos++;
                } else {
                  s3 = peg$FAILED;
                  if (peg$silentFails === 0) { peg$fail(peg$c28); }
                }
                if (s3 !== peg$FAILED) {
                  s4 = [];
                  s5 = peg$parseWS();
                  while (s5 !== peg$FAILED) {
                    s4.push(s5);
                    s5 = peg$parseWS();
                  }
                  if (s4 !== peg$FAILED) {
                    s5 = peg$parseVar();
                    if (s5 !== peg$FAILED) {
                      s6 = [];
                      s7 = peg$parseWS();
                      while (s7 !== peg$FAILED) {
                        s6.push(s7);
                        s7 = peg$parseWS();
                      }
                      if (s6 !== peg$FAILED) {
                        if (input.charCodeAt(peg$currPos) === 41) {
                          s7 = peg$c33;
                          peg$currPos++;
                        } else {
                          s7 = peg$FAILED;
                          if (peg$silentFails === 0) { peg$fail(peg$c34); }
                        }
                        if (s7 !== peg$FAILED) {
                          peg$savedPos = s0;
                          s1 = peg$c355(s5);
                          s0 = s1;
                        } else {
                          peg$currPos = s0;
                          s0 = peg$FAILED;
                        }
                      } else {
                        peg$currPos = s0;
                        s0 = peg$FAILED;
                      }
                    } else {
                      peg$currPos = s0;
                      s0 = peg$FAILED;
                    }
                  } else {
                    peg$currPos = s0;
                    s0 = peg$FAILED;
                  }
                } else {
                  peg$currPos = s0;
                  s0 = peg$FAILED;
                }
              } else {
                peg$currPos = s0;
                s0 = peg$FAILED;
              }
            } else {
              peg$currPos = s0;
              s0 = peg$FAILED;
            }
            if (s0 === peg$FAILED) {
              s0 = peg$currPos;
              if (input.substr(peg$currPos, 3) === peg$c356) {
                s1 = peg$c356;
                peg$currPos += 3;
              } else {
                s1 = peg$FAILED;
                if (peg$silentFails === 0) { peg$fail(peg$c357); }
              }
              if (s1 === peg$FAILED) {
                if (input.substr(peg$currPos, 3) === peg$c358) {
                  s1 = peg$c358;
                  peg$currPos += 3;
                } else {
                  s1 = peg$FAILED;
                  if (peg$silentFails === 0) { peg$fail(peg$c359); }
                }
              }
              if (s1 !== peg$FAILED) {
                s2 = [];
                s3 = peg$parseWS();
                while (s3 !== peg$FAILED) {
                  s2.push(s3);
                  s3 = peg$parseWS();
                }
                if (s2 !== peg$FAILED) {
                  if (input.charCodeAt(peg$currPos) === 40) {
                    s3 = peg$c27;
                    peg$currPos++;
                  } else {
                    s3 = peg$FAILED;
                    if (peg$silentFails === 0) { peg$fail(peg$c28); }
                  }
                  if (s3 !== peg$FAILED) {
                    s4 = [];
                    s5 = peg$parseWS();
                    while (s5 !== peg$FAILED) {
                      s4.push(s5);
                      s5 = peg$parseWS();
                    }
                    if (s4 !== peg$FAILED) {
                      s5 = peg$parseConditionalOrExpression();
                      if (s5 !== peg$FAILED) {
                        s6 = [];
                        s7 = peg$parseWS();
                        while (s7 !== peg$FAILED) {
                          s6.push(s7);
                          s7 = peg$parseWS();
                        }
                        if (s6 !== peg$FAILED) {
                          if (input.charCodeAt(peg$currPos) === 41) {
                            s7 = peg$c33;
                            peg$currPos++;
                          } else {
                            s7 = peg$FAILED;
                            if (peg$silentFails === 0) { peg$fail(peg$c34); }
                          }
                          if (s7 !== peg$FAILED) {
                            peg$savedPos = s0;
                            s1 = peg$c360(s5);
                            s0 = s1;
                          } else {
                            peg$currPos = s0;
                            s0 = peg$FAILED;
                          }
                        } else {
                          peg$currPos = s0;
                          s0 = peg$FAILED;
                        }
                      } else {
                        peg$currPos = s0;
                        s0 = peg$FAILED;
                      }
                    } else {
                      peg$currPos = s0;
                      s0 = peg$FAILED;
                    }
                  } else {
                    peg$currPos = s0;
                    s0 = peg$FAILED;
                  }
                } else {
                  peg$currPos = s0;
                  s0 = peg$FAILED;
                }
              } else {
                peg$currPos = s0;
                s0 = peg$FAILED;
              }
              if (s0 === peg$FAILED) {
                s0 = peg$currPos;
                if (input.substr(peg$currPos, 3) === peg$c361) {
                  s1 = peg$c361;
                  peg$currPos += 3;
                } else {
                  s1 = peg$FAILED;
                  if (peg$silentFails === 0) { peg$fail(peg$c362); }
                }
                if (s1 === peg$FAILED) {
                  if (input.substr(peg$currPos, 3) === peg$c363) {
                    s1 = peg$c363;
                    peg$currPos += 3;
                  } else {
                    s1 = peg$FAILED;
                    if (peg$silentFails === 0) { peg$fail(peg$c364); }
                  }
                }
                if (s1 !== peg$FAILED) {
                  s2 = [];
                  s3 = peg$parseWS();
                  while (s3 !== peg$FAILED) {
                    s2.push(s3);
                    s3 = peg$parseWS();
                  }
                  if (s2 !== peg$FAILED) {
                    if (input.charCodeAt(peg$currPos) === 40) {
                      s3 = peg$c27;
                      peg$currPos++;
                    } else {
                      s3 = peg$FAILED;
                      if (peg$silentFails === 0) { peg$fail(peg$c28); }
                    }
                    if (s3 !== peg$FAILED) {
                      s4 = [];
                      s5 = peg$parseWS();
                      while (s5 !== peg$FAILED) {
                        s4.push(s5);
                        s5 = peg$parseWS();
                      }
                      if (s4 !== peg$FAILED) {
                        s5 = peg$parseConditionalOrExpression();
                        if (s5 !== peg$FAILED) {
                          s6 = [];
                          s7 = peg$parseWS();
                          while (s7 !== peg$FAILED) {
                            s6.push(s7);
                            s7 = peg$parseWS();
                          }
                          if (s6 !== peg$FAILED) {
                            if (input.charCodeAt(peg$currPos) === 41) {
                              s7 = peg$c33;
                              peg$currPos++;
                            } else {
                              s7 = peg$FAILED;
                              if (peg$silentFails === 0) { peg$fail(peg$c34); }
                            }
                            if (s7 !== peg$FAILED) {
                              peg$savedPos = s0;
                              s1 = peg$c365(s5);
                              s0 = s1;
                            } else {
                              peg$currPos = s0;
                              s0 = peg$FAILED;
                            }
                          } else {
                            peg$currPos = s0;
                            s0 = peg$FAILED;
                          }
                        } else {
                          peg$currPos = s0;
                          s0 = peg$FAILED;
                        }
                      } else {
                        peg$currPos = s0;
                        s0 = peg$FAILED;
                      }
                    } else {
                      peg$currPos = s0;
                      s0 = peg$FAILED;
                    }
                  } else {
                    peg$currPos = s0;
                    s0 = peg$FAILED;
                  }
                } else {
                  peg$currPos = s0;
                  s0 = peg$FAILED;
                }
                if (s0 === peg$FAILED) {
                  s0 = peg$currPos;
                  if (input.substr(peg$currPos, 5) === peg$c366) {
                    s1 = peg$c366;
                    peg$currPos += 5;
                  } else {
                    s1 = peg$FAILED;
                    if (peg$silentFails === 0) { peg$fail(peg$c367); }
                  }
                  if (s1 === peg$FAILED) {
                    if (input.substr(peg$currPos, 5) === peg$c368) {
                      s1 = peg$c368;
                      peg$currPos += 5;
                    } else {
                      s1 = peg$FAILED;
                      if (peg$silentFails === 0) { peg$fail(peg$c369); }
                    }
                  }
                  if (s1 !== peg$FAILED) {
                    s2 = [];
                    s3 = peg$parseWS();
                    while (s3 !== peg$FAILED) {
                      s2.push(s3);
                      s3 = peg$parseWS();
                    }
                    if (s2 !== peg$FAILED) {
                      s3 = peg$currPos;
                      if (input.charCodeAt(peg$currPos) === 40) {
                        s4 = peg$c27;
                        peg$currPos++;
                      } else {
                        s4 = peg$FAILED;
                        if (peg$silentFails === 0) { peg$fail(peg$c28); }
                      }
                      if (s4 !== peg$FAILED) {
                        s5 = [];
                        s6 = peg$parseWS();
                        while (s6 !== peg$FAILED) {
                          s5.push(s6);
                          s6 = peg$parseWS();
                        }
                        if (s5 !== peg$FAILED) {
                          s6 = peg$parseConditionalOrExpression();
                          if (s6 !== peg$FAILED) {
                            s7 = [];
                            s8 = peg$parseWS();
                            while (s8 !== peg$FAILED) {
                              s7.push(s8);
                              s8 = peg$parseWS();
                            }
                            if (s7 !== peg$FAILED) {
                              if (input.charCodeAt(peg$currPos) === 41) {
                                s8 = peg$c33;
                                peg$currPos++;
                              } else {
                                s8 = peg$FAILED;
                                if (peg$silentFails === 0) { peg$fail(peg$c34); }
                              }
                              if (s8 !== peg$FAILED) {
                                s4 = [s4, s5, s6, s7, s8];
                                s3 = s4;
                              } else {
                                peg$currPos = s3;
                                s3 = peg$FAILED;
                              }
                            } else {
                              peg$currPos = s3;
                              s3 = peg$FAILED;
                            }
                          } else {
                            peg$currPos = s3;
                            s3 = peg$FAILED;
                          }
                        } else {
                          peg$currPos = s3;
                          s3 = peg$FAILED;
                        }
                      } else {
                        peg$currPos = s3;
                        s3 = peg$FAILED;
                      }
                      if (s3 === peg$FAILED) {
                        s3 = peg$parseNIL();
                      }
                      if (s3 !== peg$FAILED) {
                        peg$savedPos = s0;
                        s1 = peg$c370(s3);
                        s0 = s1;
                      } else {
                        peg$currPos = s0;
                        s0 = peg$FAILED;
                      }
                    } else {
                      peg$currPos = s0;
                      s0 = peg$FAILED;
                    }
                  } else {
                    peg$currPos = s0;
                    s0 = peg$FAILED;
                  }
                  if (s0 === peg$FAILED) {
                    s0 = peg$currPos;
                    if (input.substr(peg$currPos, 8) === peg$c371) {
                      s1 = peg$c371;
                      peg$currPos += 8;
                    } else {
                      s1 = peg$FAILED;
                      if (peg$silentFails === 0) { peg$fail(peg$c372); }
                    }
                    if (s1 === peg$FAILED) {
                      if (input.substr(peg$currPos, 8) === peg$c373) {
                        s1 = peg$c373;
                        peg$currPos += 8;
                      } else {
                        s1 = peg$FAILED;
                        if (peg$silentFails === 0) { peg$fail(peg$c374); }
                      }
                    }
                    if (s1 !== peg$FAILED) {
                      s2 = [];
                      s3 = peg$parseWS();
                      while (s3 !== peg$FAILED) {
                        s2.push(s3);
                        s3 = peg$parseWS();
                      }
                      if (s2 !== peg$FAILED) {
                        s3 = peg$parseExpressionList();
                        if (s3 !== peg$FAILED) {
                          peg$savedPos = s0;
                          s1 = peg$c375(s3);
                          s0 = s1;
                        } else {
                          peg$currPos = s0;
                          s0 = peg$FAILED;
                        }
                      } else {
                        peg$currPos = s0;
                        s0 = peg$FAILED;
                      }
                    } else {
                      peg$currPos = s0;
                      s0 = peg$FAILED;
                    }
                    if (s0 === peg$FAILED) {
                      s0 = peg$currPos;
                      if (input.substr(peg$currPos, 2) === peg$c376) {
                        s1 = peg$c376;
                        peg$currPos += 2;
                      } else {
                        s1 = peg$FAILED;
                        if (peg$silentFails === 0) { peg$fail(peg$c377); }
                      }
                      if (s1 === peg$FAILED) {
                        if (input.substr(peg$currPos, 2) === peg$c378) {
                          s1 = peg$c378;
                          peg$currPos += 2;
                        } else {
                          s1 = peg$FAILED;
                          if (peg$silentFails === 0) { peg$fail(peg$c379); }
                        }
                      }
                      if (s1 !== peg$FAILED) {
                        s2 = [];
                        s3 = peg$parseWS();
                        while (s3 !== peg$FAILED) {
                          s2.push(s3);
                          s3 = peg$parseWS();
                        }
                        if (s2 !== peg$FAILED) {
                          if (input.charCodeAt(peg$currPos) === 40) {
                            s3 = peg$c27;
                            peg$currPos++;
                          } else {
                            s3 = peg$FAILED;
                            if (peg$silentFails === 0) { peg$fail(peg$c28); }
                          }
                          if (s3 !== peg$FAILED) {
                            s4 = [];
                            s5 = peg$parseWS();
                            while (s5 !== peg$FAILED) {
                              s4.push(s5);
                              s5 = peg$parseWS();
                            }
                            if (s4 !== peg$FAILED) {
                              s5 = peg$parseConditionalOrExpression();
                              if (s5 !== peg$FAILED) {
                                s6 = [];
                                s7 = peg$parseWS();
                                while (s7 !== peg$FAILED) {
                                  s6.push(s7);
                                  s7 = peg$parseWS();
                                }
                                if (s6 !== peg$FAILED) {
                                  if (input.charCodeAt(peg$currPos) === 44) {
                                    s7 = peg$c239;
                                    peg$currPos++;
                                  } else {
                                    s7 = peg$FAILED;
                                    if (peg$silentFails === 0) { peg$fail(peg$c240); }
                                  }
                                  if (s7 !== peg$FAILED) {
                                    s8 = [];
                                    s9 = peg$parseWS();
                                    while (s9 !== peg$FAILED) {
                                      s8.push(s9);
                                      s9 = peg$parseWS();
                                    }
                                    if (s8 !== peg$FAILED) {
                                      s9 = peg$parseConditionalOrExpression();
                                      if (s9 !== peg$FAILED) {
                                        s10 = [];
                                        s11 = peg$parseWS();
                                        while (s11 !== peg$FAILED) {
                                          s10.push(s11);
                                          s11 = peg$parseWS();
                                        }
                                        if (s10 !== peg$FAILED) {
                                          if (input.charCodeAt(peg$currPos) === 44) {
                                            s11 = peg$c239;
                                            peg$currPos++;
                                          } else {
                                            s11 = peg$FAILED;
                                            if (peg$silentFails === 0) { peg$fail(peg$c240); }
                                          }
                                          if (s11 !== peg$FAILED) {
                                            s12 = [];
                                            s13 = peg$parseWS();
                                            while (s13 !== peg$FAILED) {
                                              s12.push(s13);
                                              s13 = peg$parseWS();
                                            }
                                            if (s12 !== peg$FAILED) {
                                              s13 = peg$parseConditionalOrExpression();
                                              if (s13 !== peg$FAILED) {
                                                s14 = [];
                                                s15 = peg$parseWS();
                                                while (s15 !== peg$FAILED) {
                                                  s14.push(s15);
                                                  s15 = peg$parseWS();
                                                }
                                                if (s14 !== peg$FAILED) {
                                                  if (input.charCodeAt(peg$currPos) === 41) {
                                                    s15 = peg$c33;
                                                    peg$currPos++;
                                                  } else {
                                                    s15 = peg$FAILED;
                                                    if (peg$silentFails === 0) { peg$fail(peg$c34); }
                                                  }
                                                  if (s15 !== peg$FAILED) {
                                                    peg$savedPos = s0;
                                                    s1 = peg$c380(s5, s9, s13);
                                                    s0 = s1;
                                                  } else {
                                                    peg$currPos = s0;
                                                    s0 = peg$FAILED;
                                                  }
                                                } else {
                                                  peg$currPos = s0;
                                                  s0 = peg$FAILED;
                                                }
                                              } else {
                                                peg$currPos = s0;
                                                s0 = peg$FAILED;
                                              }
                                            } else {
                                              peg$currPos = s0;
                                              s0 = peg$FAILED;
                                            }
                                          } else {
                                            peg$currPos = s0;
                                            s0 = peg$FAILED;
                                          }
                                        } else {
                                          peg$currPos = s0;
                                          s0 = peg$FAILED;
                                        }
                                      } else {
                                        peg$currPos = s0;
                                        s0 = peg$FAILED;
                                      }
                                    } else {
                                      peg$currPos = s0;
                                      s0 = peg$FAILED;
                                    }
                                  } else {
                                    peg$currPos = s0;
                                    s0 = peg$FAILED;
                                  }
                                } else {
                                  peg$currPos = s0;
                                  s0 = peg$FAILED;
                                }
                              } else {
                                peg$currPos = s0;
                                s0 = peg$FAILED;
                              }
                            } else {
                              peg$currPos = s0;
                              s0 = peg$FAILED;
                            }
                          } else {
                            peg$currPos = s0;
                            s0 = peg$FAILED;
                          }
                        } else {
                          peg$currPos = s0;
                          s0 = peg$FAILED;
                        }
                      } else {
                        peg$currPos = s0;
                        s0 = peg$FAILED;
                      }
                      if (s0 === peg$FAILED) {
                        s0 = peg$currPos;
                        if (input.substr(peg$currPos, 9) === peg$c381) {
                          s1 = peg$c381;
                          peg$currPos += 9;
                        } else {
                          s1 = peg$FAILED;
                          if (peg$silentFails === 0) { peg$fail(peg$c382); }
                        }
                        if (s1 === peg$FAILED) {
                          if (input.substr(peg$currPos, 9) === peg$c383) {
                            s1 = peg$c383;
                            peg$currPos += 9;
                          } else {
                            s1 = peg$FAILED;
                            if (peg$silentFails === 0) { peg$fail(peg$c384); }
                          }
                          if (s1 === peg$FAILED) {
                            if (input.substr(peg$currPos, 9) === peg$c385) {
                              s1 = peg$c385;
                              peg$currPos += 9;
                            } else {
                              s1 = peg$FAILED;
                              if (peg$silentFails === 0) { peg$fail(peg$c386); }
                            }
                          }
                        }
                        if (s1 !== peg$FAILED) {
                          s2 = [];
                          s3 = peg$parseWS();
                          while (s3 !== peg$FAILED) {
                            s2.push(s3);
                            s3 = peg$parseWS();
                          }
                          if (s2 !== peg$FAILED) {
                            if (input.charCodeAt(peg$currPos) === 40) {
                              s3 = peg$c27;
                              peg$currPos++;
                            } else {
                              s3 = peg$FAILED;
                              if (peg$silentFails === 0) { peg$fail(peg$c28); }
                            }
                            if (s3 !== peg$FAILED) {
                              s4 = [];
                              s5 = peg$parseWS();
                              while (s5 !== peg$FAILED) {
                                s4.push(s5);
                                s5 = peg$parseWS();
                              }
                              if (s4 !== peg$FAILED) {
                                s5 = peg$parseConditionalOrExpression();
                                if (s5 !== peg$FAILED) {
                                  s6 = [];
                                  s7 = peg$parseWS();
                                  while (s7 !== peg$FAILED) {
                                    s6.push(s7);
                                    s7 = peg$parseWS();
                                  }
                                  if (s6 !== peg$FAILED) {
                                    if (input.charCodeAt(peg$currPos) === 41) {
                                      s7 = peg$c33;
                                      peg$currPos++;
                                    } else {
                                      s7 = peg$FAILED;
                                      if (peg$silentFails === 0) { peg$fail(peg$c34); }
                                    }
                                    if (s7 !== peg$FAILED) {
                                      peg$savedPos = s0;
                                      s1 = peg$c387(s5);
                                      s0 = s1;
                                    } else {
                                      peg$currPos = s0;
                                      s0 = peg$FAILED;
                                    }
                                  } else {
                                    peg$currPos = s0;
                                    s0 = peg$FAILED;
                                  }
                                } else {
                                  peg$currPos = s0;
                                  s0 = peg$FAILED;
                                }
                              } else {
                                peg$currPos = s0;
                                s0 = peg$FAILED;
                              }
                            } else {
                              peg$currPos = s0;
                              s0 = peg$FAILED;
                            }
                          } else {
                            peg$currPos = s0;
                            s0 = peg$FAILED;
                          }
                        } else {
                          peg$currPos = s0;
                          s0 = peg$FAILED;
                        }
                        if (s0 === peg$FAILED) {
                          s0 = peg$currPos;
                          if (input.substr(peg$currPos, 7) === peg$c388) {
                            s1 = peg$c388;
                            peg$currPos += 7;
                          } else {
                            s1 = peg$FAILED;
                            if (peg$silentFails === 0) { peg$fail(peg$c389); }
                          }
                          if (s1 === peg$FAILED) {
                            if (input.substr(peg$currPos, 7) === peg$c390) {
                              s1 = peg$c390;
                              peg$currPos += 7;
                            } else {
                              s1 = peg$FAILED;
                              if (peg$silentFails === 0) { peg$fail(peg$c391); }
                            }
                            if (s1 === peg$FAILED) {
                              if (input.substr(peg$currPos, 7) === peg$c392) {
                                s1 = peg$c392;
                                peg$currPos += 7;
                              } else {
                                s1 = peg$FAILED;
                                if (peg$silentFails === 0) { peg$fail(peg$c393); }
                              }
                            }
                          }
                          if (s1 !== peg$FAILED) {
                            s2 = [];
                            s3 = peg$parseWS();
                            while (s3 !== peg$FAILED) {
                              s2.push(s3);
                              s3 = peg$parseWS();
                            }
                            if (s2 !== peg$FAILED) {
                              if (input.charCodeAt(peg$currPos) === 40) {
                                s3 = peg$c27;
                                peg$currPos++;
                              } else {
                                s3 = peg$FAILED;
                                if (peg$silentFails === 0) { peg$fail(peg$c28); }
                              }
                              if (s3 !== peg$FAILED) {
                                s4 = [];
                                s5 = peg$parseWS();
                                while (s5 !== peg$FAILED) {
                                  s4.push(s5);
                                  s5 = peg$parseWS();
                                }
                                if (s4 !== peg$FAILED) {
                                  s5 = peg$parseConditionalOrExpression();
                                  if (s5 !== peg$FAILED) {
                                    s6 = [];
                                    s7 = peg$parseWS();
                                    while (s7 !== peg$FAILED) {
                                      s6.push(s7);
                                      s7 = peg$parseWS();
                                    }
                                    if (s6 !== peg$FAILED) {
                                      if (input.charCodeAt(peg$currPos) === 41) {
                                        s7 = peg$c33;
                                        peg$currPos++;
                                      } else {
                                        s7 = peg$FAILED;
                                        if (peg$silentFails === 0) { peg$fail(peg$c34); }
                                      }
                                      if (s7 !== peg$FAILED) {
                                        peg$savedPos = s0;
                                        s1 = peg$c394(s5);
                                        s0 = s1;
                                      } else {
                                        peg$currPos = s0;
                                        s0 = peg$FAILED;
                                      }
                                    } else {
                                      peg$currPos = s0;
                                      s0 = peg$FAILED;
                                    }
                                  } else {
                                    peg$currPos = s0;
                                    s0 = peg$FAILED;
                                  }
                                } else {
                                  peg$currPos = s0;
                                  s0 = peg$FAILED;
                                }
                              } else {
                                peg$currPos = s0;
                                s0 = peg$FAILED;
                              }
                            } else {
                              peg$currPos = s0;
                              s0 = peg$FAILED;
                            }
                          } else {
                            peg$currPos = s0;
                            s0 = peg$FAILED;
                          }
                          if (s0 === peg$FAILED) {
                            s0 = peg$currPos;
                            if (input.substr(peg$currPos, 8) === peg$c395) {
                              s1 = peg$c395;
                              peg$currPos += 8;
                            } else {
                              s1 = peg$FAILED;
                              if (peg$silentFails === 0) { peg$fail(peg$c396); }
                            }
                            if (s1 === peg$FAILED) {
                              if (input.substr(peg$currPos, 8) === peg$c397) {
                                s1 = peg$c397;
                                peg$currPos += 8;
                              } else {
                                s1 = peg$FAILED;
                                if (peg$silentFails === 0) { peg$fail(peg$c398); }
                              }
                            }
                            if (s1 !== peg$FAILED) {
                              s2 = [];
                              s3 = peg$parseWS();
                              while (s3 !== peg$FAILED) {
                                s2.push(s3);
                                s3 = peg$parseWS();
                              }
                              if (s2 !== peg$FAILED) {
                                if (input.charCodeAt(peg$currPos) === 40) {
                                  s3 = peg$c27;
                                  peg$currPos++;
                                } else {
                                  s3 = peg$FAILED;
                                  if (peg$silentFails === 0) { peg$fail(peg$c28); }
                                }
                                if (s3 !== peg$FAILED) {
                                  s4 = [];
                                  s5 = peg$parseWS();
                                  while (s5 !== peg$FAILED) {
                                    s4.push(s5);
                                    s5 = peg$parseWS();
                                  }
                                  if (s4 !== peg$FAILED) {
                                    s5 = peg$parseConditionalOrExpression();
                                    if (s5 !== peg$FAILED) {
                                      s6 = [];
                                      s7 = peg$parseWS();
                                      while (s7 !== peg$FAILED) {
                                        s6.push(s7);
                                        s7 = peg$parseWS();
                                      }
                                      if (s6 !== peg$FAILED) {
                                        if (input.charCodeAt(peg$currPos) === 44) {
                                          s7 = peg$c239;
                                          peg$currPos++;
                                        } else {
                                          s7 = peg$FAILED;
                                          if (peg$silentFails === 0) { peg$fail(peg$c240); }
                                        }
                                        if (s7 !== peg$FAILED) {
                                          s8 = [];
                                          s9 = peg$parseWS();
                                          while (s9 !== peg$FAILED) {
                                            s8.push(s9);
                                            s9 = peg$parseWS();
                                          }
                                          if (s8 !== peg$FAILED) {
                                            s9 = peg$parseConditionalOrExpression();
                                            if (s9 !== peg$FAILED) {
                                              s10 = [];
                                              s11 = peg$parseWS();
                                              while (s11 !== peg$FAILED) {
                                                s10.push(s11);
                                                s11 = peg$parseWS();
                                              }
                                              if (s10 !== peg$FAILED) {
                                                if (input.charCodeAt(peg$currPos) === 41) {
                                                  s11 = peg$c33;
                                                  peg$currPos++;
                                                } else {
                                                  s11 = peg$FAILED;
                                                  if (peg$silentFails === 0) { peg$fail(peg$c34); }
                                                }
                                                if (s11 !== peg$FAILED) {
                                                  peg$savedPos = s0;
                                                  s1 = peg$c399(s5, s9);
                                                  s0 = s1;
                                                } else {
                                                  peg$currPos = s0;
                                                  s0 = peg$FAILED;
                                                }
                                              } else {
                                                peg$currPos = s0;
                                                s0 = peg$FAILED;
                                              }
                                            } else {
                                              peg$currPos = s0;
                                              s0 = peg$FAILED;
                                            }
                                          } else {
                                            peg$currPos = s0;
                                            s0 = peg$FAILED;
                                          }
                                        } else {
                                          peg$currPos = s0;
                                          s0 = peg$FAILED;
                                        }
                                      } else {
                                        peg$currPos = s0;
                                        s0 = peg$FAILED;
                                      }
                                    } else {
                                      peg$currPos = s0;
                                      s0 = peg$FAILED;
                                    }
                                  } else {
                                    peg$currPos = s0;
                                    s0 = peg$FAILED;
                                  }
                                } else {
                                  peg$currPos = s0;
                                  s0 = peg$FAILED;
                                }
                              } else {
                                peg$currPos = s0;
                                s0 = peg$FAILED;
                              }
                            } else {
                              peg$currPos = s0;
                              s0 = peg$FAILED;
                            }
                            if (s0 === peg$FAILED) {
                              s0 = peg$currPos;
                              if (input.substr(peg$currPos, 5) === peg$c400) {
                                s1 = peg$c400;
                                peg$currPos += 5;
                              } else {
                                s1 = peg$FAILED;
                                if (peg$silentFails === 0) { peg$fail(peg$c401); }
                              }
                              if (s1 === peg$FAILED) {
                                if (input.substr(peg$currPos, 5) === peg$c402) {
                                  s1 = peg$c402;
                                  peg$currPos += 5;
                                } else {
                                  s1 = peg$FAILED;
                                  if (peg$silentFails === 0) { peg$fail(peg$c403); }
                                }
                                if (s1 === peg$FAILED) {
                                  if (input.substr(peg$currPos, 5) === peg$c404) {
                                    s1 = peg$c404;
                                    peg$currPos += 5;
                                  } else {
                                    s1 = peg$FAILED;
                                    if (peg$silentFails === 0) { peg$fail(peg$c405); }
                                  }
                                  if (s1 === peg$FAILED) {
                                    if (input.substr(peg$currPos, 5) === peg$c406) {
                                      s1 = peg$c406;
                                      peg$currPos += 5;
                                    } else {
                                      s1 = peg$FAILED;
                                      if (peg$silentFails === 0) { peg$fail(peg$c407); }
                                    }
                                    if (s1 === peg$FAILED) {
                                      if (input.substr(peg$currPos, 5) === peg$c408) {
                                        s1 = peg$c408;
                                        peg$currPos += 5;
                                      } else {
                                        s1 = peg$FAILED;
                                        if (peg$silentFails === 0) { peg$fail(peg$c409); }
                                      }
                                      if (s1 === peg$FAILED) {
                                        if (input.substr(peg$currPos, 5) === peg$c410) {
                                          s1 = peg$c410;
                                          peg$currPos += 5;
                                        } else {
                                          s1 = peg$FAILED;
                                          if (peg$silentFails === 0) { peg$fail(peg$c411); }
                                        }
                                      }
                                    }
                                  }
                                }
                              }
                              if (s1 !== peg$FAILED) {
                                s2 = [];
                                s3 = peg$parseWS();
                                while (s3 !== peg$FAILED) {
                                  s2.push(s3);
                                  s3 = peg$parseWS();
                                }
                                if (s2 !== peg$FAILED) {
                                  if (input.charCodeAt(peg$currPos) === 40) {
                                    s3 = peg$c27;
                                    peg$currPos++;
                                  } else {
                                    s3 = peg$FAILED;
                                    if (peg$silentFails === 0) { peg$fail(peg$c28); }
                                  }
                                  if (s3 !== peg$FAILED) {
                                    s4 = [];
                                    s5 = peg$parseWS();
                                    while (s5 !== peg$FAILED) {
                                      s4.push(s5);
                                      s5 = peg$parseWS();
                                    }
                                    if (s4 !== peg$FAILED) {
                                      s5 = peg$parseConditionalOrExpression();
                                      if (s5 !== peg$FAILED) {
                                        s6 = [];
                                        s7 = peg$parseWS();
                                        while (s7 !== peg$FAILED) {
                                          s6.push(s7);
                                          s7 = peg$parseWS();
                                        }
                                        if (s6 !== peg$FAILED) {
                                          if (input.charCodeAt(peg$currPos) === 41) {
                                            s7 = peg$c33;
                                            peg$currPos++;
                                          } else {
                                            s7 = peg$FAILED;
                                            if (peg$silentFails === 0) { peg$fail(peg$c34); }
                                          }
                                          if (s7 !== peg$FAILED) {
                                            peg$savedPos = s0;
                                            s1 = peg$c412(s5);
                                            s0 = s1;
                                          } else {
                                            peg$currPos = s0;
                                            s0 = peg$FAILED;
                                          }
                                        } else {
                                          peg$currPos = s0;
                                          s0 = peg$FAILED;
                                        }
                                      } else {
                                        peg$currPos = s0;
                                        s0 = peg$FAILED;
                                      }
                                    } else {
                                      peg$currPos = s0;
                                      s0 = peg$FAILED;
                                    }
                                  } else {
                                    peg$currPos = s0;
                                    s0 = peg$FAILED;
                                  }
                                } else {
                                  peg$currPos = s0;
                                  s0 = peg$FAILED;
                                }
                              } else {
                                peg$currPos = s0;
                                s0 = peg$FAILED;
                              }
                              if (s0 === peg$FAILED) {
                                s0 = peg$currPos;
                                if (input.substr(peg$currPos, 7) === peg$c413) {
                                  s1 = peg$c413;
                                  peg$currPos += 7;
                                } else {
                                  s1 = peg$FAILED;
                                  if (peg$silentFails === 0) { peg$fail(peg$c414); }
                                }
                                if (s1 === peg$FAILED) {
                                  if (input.substr(peg$currPos, 7) === peg$c415) {
                                    s1 = peg$c415;
                                    peg$currPos += 7;
                                  } else {
                                    s1 = peg$FAILED;
                                    if (peg$silentFails === 0) { peg$fail(peg$c416); }
                                  }
                                }
                                if (s1 !== peg$FAILED) {
                                  s2 = [];
                                  if (peg$c417.test(input.charAt(peg$currPos))) {
                                    s3 = input.charAt(peg$currPos);
                                    peg$currPos++;
                                  } else {
                                    s3 = peg$FAILED;
                                    if (peg$silentFails === 0) { peg$fail(peg$c418); }
                                  }
                                  if (s3 !== peg$FAILED) {
                                    while (s3 !== peg$FAILED) {
                                      s2.push(s3);
                                      if (peg$c417.test(input.charAt(peg$currPos))) {
                                        s3 = input.charAt(peg$currPos);
                                        peg$currPos++;
                                      } else {
                                        s3 = peg$FAILED;
                                        if (peg$silentFails === 0) { peg$fail(peg$c418); }
                                      }
                                    }
                                  } else {
                                    s2 = peg$FAILED;
                                  }
                                  if (s2 !== peg$FAILED) {
                                    s3 = [];
                                    s4 = peg$parseWS();
                                    while (s4 !== peg$FAILED) {
                                      s3.push(s4);
                                      s4 = peg$parseWS();
                                    }
                                    if (s3 !== peg$FAILED) {
                                      if (input.charCodeAt(peg$currPos) === 40) {
                                        s4 = peg$c27;
                                        peg$currPos++;
                                      } else {
                                        s4 = peg$FAILED;
                                        if (peg$silentFails === 0) { peg$fail(peg$c28); }
                                      }
                                      if (s4 !== peg$FAILED) {
                                        s5 = [];
                                        s6 = peg$currPos;
                                        s7 = [];
                                        s8 = peg$parseWS();
                                        while (s8 !== peg$FAILED) {
                                          s7.push(s8);
                                          s8 = peg$parseWS();
                                        }
                                        if (s7 !== peg$FAILED) {
                                          s8 = peg$parseConditionalOrExpression();
                                          if (s8 !== peg$FAILED) {
                                            if (input.charCodeAt(peg$currPos) === 44) {
                                              s9 = peg$c239;
                                              peg$currPos++;
                                            } else {
                                              s9 = peg$FAILED;
                                              if (peg$silentFails === 0) { peg$fail(peg$c240); }
                                            }
                                            if (s9 !== peg$FAILED) {
                                              s7 = [s7, s8, s9];
                                              s6 = s7;
                                            } else {
                                              peg$currPos = s6;
                                              s6 = peg$FAILED;
                                            }
                                          } else {
                                            peg$currPos = s6;
                                            s6 = peg$FAILED;
                                          }
                                        } else {
                                          peg$currPos = s6;
                                          s6 = peg$FAILED;
                                        }
                                        while (s6 !== peg$FAILED) {
                                          s5.push(s6);
                                          s6 = peg$currPos;
                                          s7 = [];
                                          s8 = peg$parseWS();
                                          while (s8 !== peg$FAILED) {
                                            s7.push(s8);
                                            s8 = peg$parseWS();
                                          }
                                          if (s7 !== peg$FAILED) {
                                            s8 = peg$parseConditionalOrExpression();
                                            if (s8 !== peg$FAILED) {
                                              if (input.charCodeAt(peg$currPos) === 44) {
                                                s9 = peg$c239;
                                                peg$currPos++;
                                              } else {
                                                s9 = peg$FAILED;
                                                if (peg$silentFails === 0) { peg$fail(peg$c240); }
                                              }
                                              if (s9 !== peg$FAILED) {
                                                s7 = [s7, s8, s9];
                                                s6 = s7;
                                              } else {
                                                peg$currPos = s6;
                                                s6 = peg$FAILED;
                                              }
                                            } else {
                                              peg$currPos = s6;
                                              s6 = peg$FAILED;
                                            }
                                          } else {
                                            peg$currPos = s6;
                                            s6 = peg$FAILED;
                                          }
                                        }
                                        if (s5 !== peg$FAILED) {
                                          s6 = [];
                                          s7 = peg$parseWS();
                                          while (s7 !== peg$FAILED) {
                                            s6.push(s7);
                                            s7 = peg$parseWS();
                                          }
                                          if (s6 !== peg$FAILED) {
                                            s7 = peg$parseConditionalOrExpression();
                                            if (s7 !== peg$FAILED) {
                                              s8 = [];
                                              s9 = peg$parseWS();
                                              while (s9 !== peg$FAILED) {
                                                s8.push(s9);
                                                s9 = peg$parseWS();
                                              }
                                              if (s8 !== peg$FAILED) {
                                                if (input.charCodeAt(peg$currPos) === 41) {
                                                  s9 = peg$c33;
                                                  peg$currPos++;
                                                } else {
                                                  s9 = peg$FAILED;
                                                  if (peg$silentFails === 0) { peg$fail(peg$c34); }
                                                }
                                                if (s9 !== peg$FAILED) {
                                                  peg$savedPos = s0;
                                                  s1 = peg$c419(s2, s5, s7);
                                                  s0 = s1;
                                                } else {
                                                  peg$currPos = s0;
                                                  s0 = peg$FAILED;
                                                }
                                              } else {
                                                peg$currPos = s0;
                                                s0 = peg$FAILED;
                                              }
                                            } else {
                                              peg$currPos = s0;
                                              s0 = peg$FAILED;
                                            }
                                          } else {
                                            peg$currPos = s0;
                                            s0 = peg$FAILED;
                                          }
                                        } else {
                                          peg$currPos = s0;
                                          s0 = peg$FAILED;
                                        }
                                      } else {
                                        peg$currPos = s0;
                                        s0 = peg$FAILED;
                                      }
                                    } else {
                                      peg$currPos = s0;
                                      s0 = peg$FAILED;
                                    }
                                  } else {
                                    peg$currPos = s0;
                                    s0 = peg$FAILED;
                                  }
                                } else {
                                  peg$currPos = s0;
                                  s0 = peg$FAILED;
                                }
                                if (s0 === peg$FAILED) {
                                  s0 = peg$parseRegexExpression();
                                  if (s0 === peg$FAILED) {
                                    s0 = peg$parseExistsFunc();
                                    if (s0 === peg$FAILED) {
                                      s0 = peg$parseNotExistsFunc();
                                    }
                                  }
                                }
                              }
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }

    return s0;
  }

  function peg$parseRegexExpression() {
    var s0, s1, s2, s3, s4, s5, s6, s7, s8, s9, s10, s11, s12, s13, s14;

    s0 = peg$currPos;
    if (input.substr(peg$currPos, 5) === peg$c420) {
      s1 = peg$c420;
      peg$currPos += 5;
    } else {
      s1 = peg$FAILED;
      if (peg$silentFails === 0) { peg$fail(peg$c421); }
    }
    if (s1 === peg$FAILED) {
      if (input.substr(peg$currPos, 5) === peg$c422) {
        s1 = peg$c422;
        peg$currPos += 5;
      } else {
        s1 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c423); }
      }
    }
    if (s1 !== peg$FAILED) {
      s2 = [];
      s3 = peg$parseWS();
      while (s3 !== peg$FAILED) {
        s2.push(s3);
        s3 = peg$parseWS();
      }
      if (s2 !== peg$FAILED) {
        if (input.charCodeAt(peg$currPos) === 40) {
          s3 = peg$c27;
          peg$currPos++;
        } else {
          s3 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c28); }
        }
        if (s3 !== peg$FAILED) {
          s4 = [];
          s5 = peg$parseWS();
          while (s5 !== peg$FAILED) {
            s4.push(s5);
            s5 = peg$parseWS();
          }
          if (s4 !== peg$FAILED) {
            s5 = peg$parseConditionalOrExpression();
            if (s5 !== peg$FAILED) {
              s6 = [];
              s7 = peg$parseWS();
              while (s7 !== peg$FAILED) {
                s6.push(s7);
                s7 = peg$parseWS();
              }
              if (s6 !== peg$FAILED) {
                if (input.charCodeAt(peg$currPos) === 44) {
                  s7 = peg$c239;
                  peg$currPos++;
                } else {
                  s7 = peg$FAILED;
                  if (peg$silentFails === 0) { peg$fail(peg$c240); }
                }
                if (s7 !== peg$FAILED) {
                  s8 = [];
                  s9 = peg$parseWS();
                  while (s9 !== peg$FAILED) {
                    s8.push(s9);
                    s9 = peg$parseWS();
                  }
                  if (s8 !== peg$FAILED) {
                    s9 = peg$parseConditionalOrExpression();
                    if (s9 !== peg$FAILED) {
                      s10 = [];
                      s11 = peg$parseWS();
                      while (s11 !== peg$FAILED) {
                        s10.push(s11);
                        s11 = peg$parseWS();
                      }
                      if (s10 !== peg$FAILED) {
                        s11 = peg$currPos;
                        if (input.charCodeAt(peg$currPos) === 44) {
                          s12 = peg$c239;
                          peg$currPos++;
                        } else {
                          s12 = peg$FAILED;
                          if (peg$silentFails === 0) { peg$fail(peg$c240); }
                        }
                        if (s12 !== peg$FAILED) {
                          s13 = [];
                          s14 = peg$parseWS();
                          while (s14 !== peg$FAILED) {
                            s13.push(s14);
                            s14 = peg$parseWS();
                          }
                          if (s13 !== peg$FAILED) {
                            s14 = peg$parseConditionalOrExpression();
                            if (s14 !== peg$FAILED) {
                              s12 = [s12, s13, s14];
                              s11 = s12;
                            } else {
                              peg$currPos = s11;
                              s11 = peg$FAILED;
                            }
                          } else {
                            peg$currPos = s11;
                            s11 = peg$FAILED;
                          }
                        } else {
                          peg$currPos = s11;
                          s11 = peg$FAILED;
                        }
                        if (s11 === peg$FAILED) {
                          s11 = null;
                        }
                        if (s11 !== peg$FAILED) {
                          s12 = [];
                          s13 = peg$parseWS();
                          while (s13 !== peg$FAILED) {
                            s12.push(s13);
                            s13 = peg$parseWS();
                          }
                          if (s12 !== peg$FAILED) {
                            if (input.charCodeAt(peg$currPos) === 41) {
                              s13 = peg$c33;
                              peg$currPos++;
                            } else {
                              s13 = peg$FAILED;
                              if (peg$silentFails === 0) { peg$fail(peg$c34); }
                            }
                            if (s13 !== peg$FAILED) {
                              peg$savedPos = s0;
                              s1 = peg$c424(s5, s9, s11);
                              s0 = s1;
                            } else {
                              peg$currPos = s0;
                              s0 = peg$FAILED;
                            }
                          } else {
                            peg$currPos = s0;
                            s0 = peg$FAILED;
                          }
                        } else {
                          peg$currPos = s0;
                          s0 = peg$FAILED;
                        }
                      } else {
                        peg$currPos = s0;
                        s0 = peg$FAILED;
                      }
                    } else {
                      peg$currPos = s0;
                      s0 = peg$FAILED;
                    }
                  } else {
                    peg$currPos = s0;
                    s0 = peg$FAILED;
                  }
                } else {
                  peg$currPos = s0;
                  s0 = peg$FAILED;
                }
              } else {
                peg$currPos = s0;
                s0 = peg$FAILED;
              }
            } else {
              peg$currPos = s0;
              s0 = peg$FAILED;
            }
          } else {
            peg$currPos = s0;
            s0 = peg$FAILED;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }

    return s0;
  }

  function peg$parseExistsFunc() {
    var s0, s1, s2, s3;

    s0 = peg$currPos;
    if (input.substr(peg$currPos, 6) === peg$c425) {
      s1 = peg$c425;
      peg$currPos += 6;
    } else {
      s1 = peg$FAILED;
      if (peg$silentFails === 0) { peg$fail(peg$c426); }
    }
    if (s1 === peg$FAILED) {
      if (input.substr(peg$currPos, 6) === peg$c427) {
        s1 = peg$c427;
        peg$currPos += 6;
      } else {
        s1 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c428); }
      }
    }
    if (s1 !== peg$FAILED) {
      s2 = [];
      s3 = peg$parseWS();
      while (s3 !== peg$FAILED) {
        s2.push(s3);
        s3 = peg$parseWS();
      }
      if (s2 !== peg$FAILED) {
        s3 = peg$parseGroupGraphPattern();
        if (s3 !== peg$FAILED) {
          peg$savedPos = s0;
          s1 = peg$c429(s3);
          s0 = s1;
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }

    return s0;
  }

  function peg$parseNotExistsFunc() {
    var s0, s1, s2, s3, s4, s5;

    s0 = peg$currPos;
    if (input.substr(peg$currPos, 3) === peg$c430) {
      s1 = peg$c430;
      peg$currPos += 3;
    } else {
      s1 = peg$FAILED;
      if (peg$silentFails === 0) { peg$fail(peg$c431); }
    }
    if (s1 === peg$FAILED) {
      if (input.substr(peg$currPos, 3) === peg$c432) {
        s1 = peg$c432;
        peg$currPos += 3;
      } else {
        s1 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c433); }
      }
    }
    if (s1 !== peg$FAILED) {
      s2 = [];
      s3 = peg$parseWS();
      while (s3 !== peg$FAILED) {
        s2.push(s3);
        s3 = peg$parseWS();
      }
      if (s2 !== peg$FAILED) {
        if (input.substr(peg$currPos, 6) === peg$c425) {
          s3 = peg$c425;
          peg$currPos += 6;
        } else {
          s3 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c426); }
        }
        if (s3 === peg$FAILED) {
          if (input.substr(peg$currPos, 6) === peg$c427) {
            s3 = peg$c427;
            peg$currPos += 6;
          } else {
            s3 = peg$FAILED;
            if (peg$silentFails === 0) { peg$fail(peg$c428); }
          }
        }
        if (s3 !== peg$FAILED) {
          s4 = [];
          s5 = peg$parseWS();
          while (s5 !== peg$FAILED) {
            s4.push(s5);
            s5 = peg$parseWS();
          }
          if (s4 !== peg$FAILED) {
            s5 = peg$parseGroupGraphPattern();
            if (s5 !== peg$FAILED) {
              peg$savedPos = s0;
              s1 = peg$c434(s5);
              s0 = s1;
            } else {
              peg$currPos = s0;
              s0 = peg$FAILED;
            }
          } else {
            peg$currPos = s0;
            s0 = peg$FAILED;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }

    return s0;
  }

  function peg$parseAggregate() {
    var s0, s1, s2, s3, s4, s5, s6, s7, s8, s9, s10, s11, s12, s13, s14, s15, s16, s17;

    s0 = peg$currPos;
    if (input.substr(peg$currPos, 5) === peg$c435) {
      s1 = peg$c435;
      peg$currPos += 5;
    } else {
      s1 = peg$FAILED;
      if (peg$silentFails === 0) { peg$fail(peg$c436); }
    }
    if (s1 === peg$FAILED) {
      if (input.substr(peg$currPos, 5) === peg$c437) {
        s1 = peg$c437;
        peg$currPos += 5;
      } else {
        s1 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c438); }
      }
    }
    if (s1 !== peg$FAILED) {
      s2 = [];
      s3 = peg$parseWS();
      while (s3 !== peg$FAILED) {
        s2.push(s3);
        s3 = peg$parseWS();
      }
      if (s2 !== peg$FAILED) {
        if (input.charCodeAt(peg$currPos) === 40) {
          s3 = peg$c27;
          peg$currPos++;
        } else {
          s3 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c28); }
        }
        if (s3 !== peg$FAILED) {
          s4 = [];
          s5 = peg$parseWS();
          while (s5 !== peg$FAILED) {
            s4.push(s5);
            s5 = peg$parseWS();
          }
          if (s4 !== peg$FAILED) {
            if (input.substr(peg$currPos, 8) === peg$c19) {
              s5 = peg$c19;
              peg$currPos += 8;
            } else {
              s5 = peg$FAILED;
              if (peg$silentFails === 0) { peg$fail(peg$c20); }
            }
            if (s5 === peg$FAILED) {
              if (input.substr(peg$currPos, 8) === peg$c21) {
                s5 = peg$c21;
                peg$currPos += 8;
              } else {
                s5 = peg$FAILED;
                if (peg$silentFails === 0) { peg$fail(peg$c22); }
              }
            }
            if (s5 === peg$FAILED) {
              s5 = null;
            }
            if (s5 !== peg$FAILED) {
              s6 = [];
              s7 = peg$parseWS();
              while (s7 !== peg$FAILED) {
                s6.push(s7);
                s7 = peg$parseWS();
              }
              if (s6 !== peg$FAILED) {
                if (input.charCodeAt(peg$currPos) === 42) {
                  s7 = peg$c35;
                  peg$currPos++;
                } else {
                  s7 = peg$FAILED;
                  if (peg$silentFails === 0) { peg$fail(peg$c36); }
                }
                if (s7 === peg$FAILED) {
                  s7 = peg$parseConditionalOrExpression();
                }
                if (s7 !== peg$FAILED) {
                  s8 = [];
                  s9 = peg$parseWS();
                  while (s9 !== peg$FAILED) {
                    s8.push(s9);
                    s9 = peg$parseWS();
                  }
                  if (s8 !== peg$FAILED) {
                    if (input.charCodeAt(peg$currPos) === 41) {
                      s9 = peg$c33;
                      peg$currPos++;
                    } else {
                      s9 = peg$FAILED;
                      if (peg$silentFails === 0) { peg$fail(peg$c34); }
                    }
                    if (s9 !== peg$FAILED) {
                      s10 = [];
                      s11 = peg$parseWS();
                      while (s11 !== peg$FAILED) {
                        s10.push(s11);
                        s11 = peg$parseWS();
                      }
                      if (s10 !== peg$FAILED) {
                        peg$savedPos = s0;
                        s1 = peg$c439(s5, s7);
                        s0 = s1;
                      } else {
                        peg$currPos = s0;
                        s0 = peg$FAILED;
                      }
                    } else {
                      peg$currPos = s0;
                      s0 = peg$FAILED;
                    }
                  } else {
                    peg$currPos = s0;
                    s0 = peg$FAILED;
                  }
                } else {
                  peg$currPos = s0;
                  s0 = peg$FAILED;
                }
              } else {
                peg$currPos = s0;
                s0 = peg$FAILED;
              }
            } else {
              peg$currPos = s0;
              s0 = peg$FAILED;
            }
          } else {
            peg$currPos = s0;
            s0 = peg$FAILED;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }
    if (s0 === peg$FAILED) {
      s0 = peg$currPos;
      if (input.substr(peg$currPos, 12) === peg$c440) {
        s1 = peg$c440;
        peg$currPos += 12;
      } else {
        s1 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c441); }
      }
      if (s1 === peg$FAILED) {
        if (input.substr(peg$currPos, 12) === peg$c442) {
          s1 = peg$c442;
          peg$currPos += 12;
        } else {
          s1 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c443); }
        }
      }
      if (s1 !== peg$FAILED) {
        s2 = [];
        s3 = peg$parseWS();
        while (s3 !== peg$FAILED) {
          s2.push(s3);
          s3 = peg$parseWS();
        }
        if (s2 !== peg$FAILED) {
          if (input.charCodeAt(peg$currPos) === 40) {
            s3 = peg$c27;
            peg$currPos++;
          } else {
            s3 = peg$FAILED;
            if (peg$silentFails === 0) { peg$fail(peg$c28); }
          }
          if (s3 !== peg$FAILED) {
            s4 = [];
            s5 = peg$parseWS();
            while (s5 !== peg$FAILED) {
              s4.push(s5);
              s5 = peg$parseWS();
            }
            if (s4 !== peg$FAILED) {
              if (input.substr(peg$currPos, 8) === peg$c19) {
                s5 = peg$c19;
                peg$currPos += 8;
              } else {
                s5 = peg$FAILED;
                if (peg$silentFails === 0) { peg$fail(peg$c20); }
              }
              if (s5 === peg$FAILED) {
                if (input.substr(peg$currPos, 8) === peg$c21) {
                  s5 = peg$c21;
                  peg$currPos += 8;
                } else {
                  s5 = peg$FAILED;
                  if (peg$silentFails === 0) { peg$fail(peg$c22); }
                }
              }
              if (s5 === peg$FAILED) {
                s5 = null;
              }
              if (s5 !== peg$FAILED) {
                s6 = [];
                s7 = peg$parseWS();
                while (s7 !== peg$FAILED) {
                  s6.push(s7);
                  s7 = peg$parseWS();
                }
                if (s6 !== peg$FAILED) {
                  s7 = peg$parseConditionalOrExpression();
                  if (s7 !== peg$FAILED) {
                    s8 = peg$currPos;
                    if (input.charCodeAt(peg$currPos) === 59) {
                      s9 = peg$c122;
                      peg$currPos++;
                    } else {
                      s9 = peg$FAILED;
                      if (peg$silentFails === 0) { peg$fail(peg$c123); }
                    }
                    if (s9 !== peg$FAILED) {
                      s10 = [];
                      s11 = peg$parseWS();
                      while (s11 !== peg$FAILED) {
                        s10.push(s11);
                        s11 = peg$parseWS();
                      }
                      if (s10 !== peg$FAILED) {
                        if (input.substr(peg$currPos, 9) === peg$c444) {
                          s11 = peg$c444;
                          peg$currPos += 9;
                        } else {
                          s11 = peg$FAILED;
                          if (peg$silentFails === 0) { peg$fail(peg$c445); }
                        }
                        if (s11 !== peg$FAILED) {
                          s12 = [];
                          s13 = peg$parseWS();
                          while (s13 !== peg$FAILED) {
                            s12.push(s13);
                            s13 = peg$parseWS();
                          }
                          if (s12 !== peg$FAILED) {
                            if (input.charCodeAt(peg$currPos) === 61) {
                              s13 = peg$c290;
                              peg$currPos++;
                            } else {
                              s13 = peg$FAILED;
                              if (peg$silentFails === 0) { peg$fail(peg$c291); }
                            }
                            if (s13 !== peg$FAILED) {
                              s14 = [];
                              s15 = peg$parseWS();
                              while (s15 !== peg$FAILED) {
                                s14.push(s15);
                                s15 = peg$parseWS();
                              }
                              if (s14 !== peg$FAILED) {
                                s15 = peg$parseString();
                                if (s15 !== peg$FAILED) {
                                  s16 = [];
                                  s17 = peg$parseWS();
                                  while (s17 !== peg$FAILED) {
                                    s16.push(s17);
                                    s17 = peg$parseWS();
                                  }
                                  if (s16 !== peg$FAILED) {
                                    s9 = [s9, s10, s11, s12, s13, s14, s15, s16];
                                    s8 = s9;
                                  } else {
                                    peg$currPos = s8;
                                    s8 = peg$FAILED;
                                  }
                                } else {
                                  peg$currPos = s8;
                                  s8 = peg$FAILED;
                                }
                              } else {
                                peg$currPos = s8;
                                s8 = peg$FAILED;
                              }
                            } else {
                              peg$currPos = s8;
                              s8 = peg$FAILED;
                            }
                          } else {
                            peg$currPos = s8;
                            s8 = peg$FAILED;
                          }
                        } else {
                          peg$currPos = s8;
                          s8 = peg$FAILED;
                        }
                      } else {
                        peg$currPos = s8;
                        s8 = peg$FAILED;
                      }
                    } else {
                      peg$currPos = s8;
                      s8 = peg$FAILED;
                    }
                    if (s8 === peg$FAILED) {
                      s8 = null;
                    }
                    if (s8 !== peg$FAILED) {
                      if (input.charCodeAt(peg$currPos) === 41) {
                        s9 = peg$c33;
                        peg$currPos++;
                      } else {
                        s9 = peg$FAILED;
                        if (peg$silentFails === 0) { peg$fail(peg$c34); }
                      }
                      if (s9 !== peg$FAILED) {
                        s10 = [];
                        s11 = peg$parseWS();
                        while (s11 !== peg$FAILED) {
                          s10.push(s11);
                          s11 = peg$parseWS();
                        }
                        if (s10 !== peg$FAILED) {
                          peg$savedPos = s0;
                          s1 = peg$c446(s5, s7, s8);
                          s0 = s1;
                        } else {
                          peg$currPos = s0;
                          s0 = peg$FAILED;
                        }
                      } else {
                        peg$currPos = s0;
                        s0 = peg$FAILED;
                      }
                    } else {
                      peg$currPos = s0;
                      s0 = peg$FAILED;
                    }
                  } else {
                    peg$currPos = s0;
                    s0 = peg$FAILED;
                  }
                } else {
                  peg$currPos = s0;
                  s0 = peg$FAILED;
                }
              } else {
                peg$currPos = s0;
                s0 = peg$FAILED;
              }
            } else {
              peg$currPos = s0;
              s0 = peg$FAILED;
            }
          } else {
            peg$currPos = s0;
            s0 = peg$FAILED;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
      if (s0 === peg$FAILED) {
        s0 = peg$currPos;
        if (input.substr(peg$currPos, 3) === peg$c447) {
          s1 = peg$c447;
          peg$currPos += 3;
        } else {
          s1 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c448); }
        }
        if (s1 === peg$FAILED) {
          if (input.substr(peg$currPos, 3) === peg$c449) {
            s1 = peg$c449;
            peg$currPos += 3;
          } else {
            s1 = peg$FAILED;
            if (peg$silentFails === 0) { peg$fail(peg$c450); }
          }
        }
        if (s1 !== peg$FAILED) {
          s2 = [];
          s3 = peg$parseWS();
          while (s3 !== peg$FAILED) {
            s2.push(s3);
            s3 = peg$parseWS();
          }
          if (s2 !== peg$FAILED) {
            if (input.charCodeAt(peg$currPos) === 40) {
              s3 = peg$c27;
              peg$currPos++;
            } else {
              s3 = peg$FAILED;
              if (peg$silentFails === 0) { peg$fail(peg$c28); }
            }
            if (s3 !== peg$FAILED) {
              s4 = [];
              s5 = peg$parseWS();
              while (s5 !== peg$FAILED) {
                s4.push(s5);
                s5 = peg$parseWS();
              }
              if (s4 !== peg$FAILED) {
                if (input.substr(peg$currPos, 8) === peg$c19) {
                  s5 = peg$c19;
                  peg$currPos += 8;
                } else {
                  s5 = peg$FAILED;
                  if (peg$silentFails === 0) { peg$fail(peg$c20); }
                }
                if (s5 === peg$FAILED) {
                  if (input.substr(peg$currPos, 8) === peg$c21) {
                    s5 = peg$c21;
                    peg$currPos += 8;
                  } else {
                    s5 = peg$FAILED;
                    if (peg$silentFails === 0) { peg$fail(peg$c22); }
                  }
                }
                if (s5 === peg$FAILED) {
                  s5 = null;
                }
                if (s5 !== peg$FAILED) {
                  s6 = [];
                  s7 = peg$parseWS();
                  while (s7 !== peg$FAILED) {
                    s6.push(s7);
                    s7 = peg$parseWS();
                  }
                  if (s6 !== peg$FAILED) {
                    s7 = peg$parseConditionalOrExpression();
                    if (s7 !== peg$FAILED) {
                      s8 = [];
                      s9 = peg$parseWS();
                      while (s9 !== peg$FAILED) {
                        s8.push(s9);
                        s9 = peg$parseWS();
                      }
                      if (s8 !== peg$FAILED) {
                        if (input.charCodeAt(peg$currPos) === 41) {
                          s9 = peg$c33;
                          peg$currPos++;
                        } else {
                          s9 = peg$FAILED;
                          if (peg$silentFails === 0) { peg$fail(peg$c34); }
                        }
                        if (s9 !== peg$FAILED) {
                          s10 = [];
                          s11 = peg$parseWS();
                          while (s11 !== peg$FAILED) {
                            s10.push(s11);
                            s11 = peg$parseWS();
                          }
                          if (s10 !== peg$FAILED) {
                            peg$savedPos = s0;
                            s1 = peg$c451(s5, s7);
                            s0 = s1;
                          } else {
                            peg$currPos = s0;
                            s0 = peg$FAILED;
                          }
                        } else {
                          peg$currPos = s0;
                          s0 = peg$FAILED;
                        }
                      } else {
                        peg$currPos = s0;
                        s0 = peg$FAILED;
                      }
                    } else {
                      peg$currPos = s0;
                      s0 = peg$FAILED;
                    }
                  } else {
                    peg$currPos = s0;
                    s0 = peg$FAILED;
                  }
                } else {
                  peg$currPos = s0;
                  s0 = peg$FAILED;
                }
              } else {
                peg$currPos = s0;
                s0 = peg$FAILED;
              }
            } else {
              peg$currPos = s0;
              s0 = peg$FAILED;
            }
          } else {
            peg$currPos = s0;
            s0 = peg$FAILED;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
        if (s0 === peg$FAILED) {
          s0 = peg$currPos;
          if (input.substr(peg$currPos, 3) === peg$c452) {
            s1 = peg$c452;
            peg$currPos += 3;
          } else {
            s1 = peg$FAILED;
            if (peg$silentFails === 0) { peg$fail(peg$c453); }
          }
          if (s1 === peg$FAILED) {
            if (input.substr(peg$currPos, 3) === peg$c454) {
              s1 = peg$c454;
              peg$currPos += 3;
            } else {
              s1 = peg$FAILED;
              if (peg$silentFails === 0) { peg$fail(peg$c455); }
            }
          }
          if (s1 !== peg$FAILED) {
            s2 = [];
            s3 = peg$parseWS();
            while (s3 !== peg$FAILED) {
              s2.push(s3);
              s3 = peg$parseWS();
            }
            if (s2 !== peg$FAILED) {
              if (input.charCodeAt(peg$currPos) === 40) {
                s3 = peg$c27;
                peg$currPos++;
              } else {
                s3 = peg$FAILED;
                if (peg$silentFails === 0) { peg$fail(peg$c28); }
              }
              if (s3 !== peg$FAILED) {
                s4 = [];
                s5 = peg$parseWS();
                while (s5 !== peg$FAILED) {
                  s4.push(s5);
                  s5 = peg$parseWS();
                }
                if (s4 !== peg$FAILED) {
                  if (input.substr(peg$currPos, 8) === peg$c19) {
                    s5 = peg$c19;
                    peg$currPos += 8;
                  } else {
                    s5 = peg$FAILED;
                    if (peg$silentFails === 0) { peg$fail(peg$c20); }
                  }
                  if (s5 === peg$FAILED) {
                    if (input.substr(peg$currPos, 8) === peg$c21) {
                      s5 = peg$c21;
                      peg$currPos += 8;
                    } else {
                      s5 = peg$FAILED;
                      if (peg$silentFails === 0) { peg$fail(peg$c22); }
                    }
                  }
                  if (s5 === peg$FAILED) {
                    s5 = null;
                  }
                  if (s5 !== peg$FAILED) {
                    s6 = [];
                    s7 = peg$parseWS();
                    while (s7 !== peg$FAILED) {
                      s6.push(s7);
                      s7 = peg$parseWS();
                    }
                    if (s6 !== peg$FAILED) {
                      s7 = peg$parseConditionalOrExpression();
                      if (s7 !== peg$FAILED) {
                        s8 = [];
                        s9 = peg$parseWS();
                        while (s9 !== peg$FAILED) {
                          s8.push(s9);
                          s9 = peg$parseWS();
                        }
                        if (s8 !== peg$FAILED) {
                          if (input.charCodeAt(peg$currPos) === 41) {
                            s9 = peg$c33;
                            peg$currPos++;
                          } else {
                            s9 = peg$FAILED;
                            if (peg$silentFails === 0) { peg$fail(peg$c34); }
                          }
                          if (s9 !== peg$FAILED) {
                            s10 = [];
                            s11 = peg$parseWS();
                            while (s11 !== peg$FAILED) {
                              s10.push(s11);
                              s11 = peg$parseWS();
                            }
                            if (s10 !== peg$FAILED) {
                              peg$savedPos = s0;
                              s1 = peg$c456(s5, s7);
                              s0 = s1;
                            } else {
                              peg$currPos = s0;
                              s0 = peg$FAILED;
                            }
                          } else {
                            peg$currPos = s0;
                            s0 = peg$FAILED;
                          }
                        } else {
                          peg$currPos = s0;
                          s0 = peg$FAILED;
                        }
                      } else {
                        peg$currPos = s0;
                        s0 = peg$FAILED;
                      }
                    } else {
                      peg$currPos = s0;
                      s0 = peg$FAILED;
                    }
                  } else {
                    peg$currPos = s0;
                    s0 = peg$FAILED;
                  }
                } else {
                  peg$currPos = s0;
                  s0 = peg$FAILED;
                }
              } else {
                peg$currPos = s0;
                s0 = peg$FAILED;
              }
            } else {
              peg$currPos = s0;
              s0 = peg$FAILED;
            }
          } else {
            peg$currPos = s0;
            s0 = peg$FAILED;
          }
          if (s0 === peg$FAILED) {
            s0 = peg$currPos;
            if (input.substr(peg$currPos, 3) === peg$c457) {
              s1 = peg$c457;
              peg$currPos += 3;
            } else {
              s1 = peg$FAILED;
              if (peg$silentFails === 0) { peg$fail(peg$c458); }
            }
            if (s1 === peg$FAILED) {
              if (input.substr(peg$currPos, 3) === peg$c459) {
                s1 = peg$c459;
                peg$currPos += 3;
              } else {
                s1 = peg$FAILED;
                if (peg$silentFails === 0) { peg$fail(peg$c460); }
              }
            }
            if (s1 !== peg$FAILED) {
              s2 = [];
              s3 = peg$parseWS();
              while (s3 !== peg$FAILED) {
                s2.push(s3);
                s3 = peg$parseWS();
              }
              if (s2 !== peg$FAILED) {
                if (input.charCodeAt(peg$currPos) === 40) {
                  s3 = peg$c27;
                  peg$currPos++;
                } else {
                  s3 = peg$FAILED;
                  if (peg$silentFails === 0) { peg$fail(peg$c28); }
                }
                if (s3 !== peg$FAILED) {
                  s4 = [];
                  s5 = peg$parseWS();
                  while (s5 !== peg$FAILED) {
                    s4.push(s5);
                    s5 = peg$parseWS();
                  }
                  if (s4 !== peg$FAILED) {
                    if (input.substr(peg$currPos, 8) === peg$c19) {
                      s5 = peg$c19;
                      peg$currPos += 8;
                    } else {
                      s5 = peg$FAILED;
                      if (peg$silentFails === 0) { peg$fail(peg$c20); }
                    }
                    if (s5 === peg$FAILED) {
                      if (input.substr(peg$currPos, 8) === peg$c21) {
                        s5 = peg$c21;
                        peg$currPos += 8;
                      } else {
                        s5 = peg$FAILED;
                        if (peg$silentFails === 0) { peg$fail(peg$c22); }
                      }
                    }
                    if (s5 === peg$FAILED) {
                      s5 = null;
                    }
                    if (s5 !== peg$FAILED) {
                      s6 = [];
                      s7 = peg$parseWS();
                      while (s7 !== peg$FAILED) {
                        s6.push(s7);
                        s7 = peg$parseWS();
                      }
                      if (s6 !== peg$FAILED) {
                        s7 = peg$parseConditionalOrExpression();
                        if (s7 !== peg$FAILED) {
                          s8 = [];
                          s9 = peg$parseWS();
                          while (s9 !== peg$FAILED) {
                            s8.push(s9);
                            s9 = peg$parseWS();
                          }
                          if (s8 !== peg$FAILED) {
                            if (input.charCodeAt(peg$currPos) === 41) {
                              s9 = peg$c33;
                              peg$currPos++;
                            } else {
                              s9 = peg$FAILED;
                              if (peg$silentFails === 0) { peg$fail(peg$c34); }
                            }
                            if (s9 !== peg$FAILED) {
                              s10 = [];
                              s11 = peg$parseWS();
                              while (s11 !== peg$FAILED) {
                                s10.push(s11);
                                s11 = peg$parseWS();
                              }
                              if (s10 !== peg$FAILED) {
                                peg$savedPos = s0;
                                s1 = peg$c461(s5, s7);
                                s0 = s1;
                              } else {
                                peg$currPos = s0;
                                s0 = peg$FAILED;
                              }
                            } else {
                              peg$currPos = s0;
                              s0 = peg$FAILED;
                            }
                          } else {
                            peg$currPos = s0;
                            s0 = peg$FAILED;
                          }
                        } else {
                          peg$currPos = s0;
                          s0 = peg$FAILED;
                        }
                      } else {
                        peg$currPos = s0;
                        s0 = peg$FAILED;
                      }
                    } else {
                      peg$currPos = s0;
                      s0 = peg$FAILED;
                    }
                  } else {
                    peg$currPos = s0;
                    s0 = peg$FAILED;
                  }
                } else {
                  peg$currPos = s0;
                  s0 = peg$FAILED;
                }
              } else {
                peg$currPos = s0;
                s0 = peg$FAILED;
              }
            } else {
              peg$currPos = s0;
              s0 = peg$FAILED;
            }
            if (s0 === peg$FAILED) {
              s0 = peg$currPos;
              if (input.substr(peg$currPos, 3) === peg$c462) {
                s1 = peg$c462;
                peg$currPos += 3;
              } else {
                s1 = peg$FAILED;
                if (peg$silentFails === 0) { peg$fail(peg$c463); }
              }
              if (s1 === peg$FAILED) {
                if (input.substr(peg$currPos, 3) === peg$c464) {
                  s1 = peg$c464;
                  peg$currPos += 3;
                } else {
                  s1 = peg$FAILED;
                  if (peg$silentFails === 0) { peg$fail(peg$c465); }
                }
              }
              if (s1 !== peg$FAILED) {
                s2 = [];
                s3 = peg$parseWS();
                while (s3 !== peg$FAILED) {
                  s2.push(s3);
                  s3 = peg$parseWS();
                }
                if (s2 !== peg$FAILED) {
                  if (input.charCodeAt(peg$currPos) === 40) {
                    s3 = peg$c27;
                    peg$currPos++;
                  } else {
                    s3 = peg$FAILED;
                    if (peg$silentFails === 0) { peg$fail(peg$c28); }
                  }
                  if (s3 !== peg$FAILED) {
                    s4 = [];
                    s5 = peg$parseWS();
                    while (s5 !== peg$FAILED) {
                      s4.push(s5);
                      s5 = peg$parseWS();
                    }
                    if (s4 !== peg$FAILED) {
                      if (input.substr(peg$currPos, 8) === peg$c19) {
                        s5 = peg$c19;
                        peg$currPos += 8;
                      } else {
                        s5 = peg$FAILED;
                        if (peg$silentFails === 0) { peg$fail(peg$c20); }
                      }
                      if (s5 === peg$FAILED) {
                        if (input.substr(peg$currPos, 8) === peg$c21) {
                          s5 = peg$c21;
                          peg$currPos += 8;
                        } else {
                          s5 = peg$FAILED;
                          if (peg$silentFails === 0) { peg$fail(peg$c22); }
                        }
                      }
                      if (s5 === peg$FAILED) {
                        s5 = null;
                      }
                      if (s5 !== peg$FAILED) {
                        s6 = [];
                        s7 = peg$parseWS();
                        while (s7 !== peg$FAILED) {
                          s6.push(s7);
                          s7 = peg$parseWS();
                        }
                        if (s6 !== peg$FAILED) {
                          s7 = peg$parseConditionalOrExpression();
                          if (s7 !== peg$FAILED) {
                            s8 = [];
                            s9 = peg$parseWS();
                            while (s9 !== peg$FAILED) {
                              s8.push(s9);
                              s9 = peg$parseWS();
                            }
                            if (s8 !== peg$FAILED) {
                              if (input.charCodeAt(peg$currPos) === 41) {
                                s9 = peg$c33;
                                peg$currPos++;
                              } else {
                                s9 = peg$FAILED;
                                if (peg$silentFails === 0) { peg$fail(peg$c34); }
                              }
                              if (s9 !== peg$FAILED) {
                                s10 = [];
                                s11 = peg$parseWS();
                                while (s11 !== peg$FAILED) {
                                  s10.push(s11);
                                  s11 = peg$parseWS();
                                }
                                if (s10 !== peg$FAILED) {
                                  peg$savedPos = s0;
                                  s1 = peg$c466(s5, s7);
                                  s0 = s1;
                                } else {
                                  peg$currPos = s0;
                                  s0 = peg$FAILED;
                                }
                              } else {
                                peg$currPos = s0;
                                s0 = peg$FAILED;
                              }
                            } else {
                              peg$currPos = s0;
                              s0 = peg$FAILED;
                            }
                          } else {
                            peg$currPos = s0;
                            s0 = peg$FAILED;
                          }
                        } else {
                          peg$currPos = s0;
                          s0 = peg$FAILED;
                        }
                      } else {
                        peg$currPos = s0;
                        s0 = peg$FAILED;
                      }
                    } else {
                      peg$currPos = s0;
                      s0 = peg$FAILED;
                    }
                  } else {
                    peg$currPos = s0;
                    s0 = peg$FAILED;
                  }
                } else {
                  peg$currPos = s0;
                  s0 = peg$FAILED;
                }
              } else {
                peg$currPos = s0;
                s0 = peg$FAILED;
              }
            }
          }
        }
      }
    }

    return s0;
  }

  function peg$parseIRIrefOrFunction() {
    var s0, s1, s2, s3;

    s0 = peg$currPos;
    s1 = peg$parseIRIref();
    if (s1 !== peg$FAILED) {
      s2 = [];
      s3 = peg$parseWS();
      while (s3 !== peg$FAILED) {
        s2.push(s3);
        s3 = peg$parseWS();
      }
      if (s2 !== peg$FAILED) {
        s3 = peg$parseArgList();
        if (s3 === peg$FAILED) {
          s3 = null;
        }
        if (s3 !== peg$FAILED) {
          peg$savedPos = s0;
          s1 = peg$c467(s1, s3);
          s0 = s1;
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }

    return s0;
  }

  function peg$parseRDFLiteral() {
    var s0, s1, s2, s3, s4;

    s0 = peg$currPos;
    s1 = peg$parseString();
    if (s1 !== peg$FAILED) {
      s2 = peg$parseLANGTAG();
      if (s2 === peg$FAILED) {
        s2 = peg$currPos;
        if (input.substr(peg$currPos, 2) === peg$c468) {
          s3 = peg$c468;
          peg$currPos += 2;
        } else {
          s3 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c469); }
        }
        if (s3 !== peg$FAILED) {
          s4 = peg$parseIRIref();
          if (s4 !== peg$FAILED) {
            s3 = [s3, s4];
            s2 = s3;
          } else {
            peg$currPos = s2;
            s2 = peg$FAILED;
          }
        } else {
          peg$currPos = s2;
          s2 = peg$FAILED;
        }
      }
      if (s2 === peg$FAILED) {
        s2 = null;
      }
      if (s2 !== peg$FAILED) {
        peg$savedPos = s0;
        s1 = peg$c470(s1, s2);
        s0 = s1;
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }

    return s0;
  }

  function peg$parseNumericLiteral() {
    var s0;

    s0 = peg$parseNumericLiteralUnsigned();
    if (s0 === peg$FAILED) {
      s0 = peg$parseNumericLiteralPositive();
      if (s0 === peg$FAILED) {
        s0 = peg$parseNumericLiteralNegative();
      }
    }

    return s0;
  }

  function peg$parseNumericLiteralUnsigned() {
    var s0;

    s0 = peg$parseDOUBLE();
    if (s0 === peg$FAILED) {
      s0 = peg$parseDECIMAL();
      if (s0 === peg$FAILED) {
        s0 = peg$parseINTEGER();
      }
    }

    return s0;
  }

  function peg$parseNumericLiteralPositive() {
    var s0;

    s0 = peg$parseDOUBLE_POSITIVE();
    if (s0 === peg$FAILED) {
      s0 = peg$parseDECIMAL_POSITIVE();
      if (s0 === peg$FAILED) {
        s0 = peg$parseINTEGER_POSITIVE();
      }
    }

    return s0;
  }

  function peg$parseNumericLiteralNegative() {
    var s0;

    s0 = peg$parseDOUBLE_NEGATIVE();
    if (s0 === peg$FAILED) {
      s0 = peg$parseDECIMAL_NEGATIVE();
      if (s0 === peg$FAILED) {
        s0 = peg$parseINTEGER_NEGATIVE();
      }
    }

    return s0;
  }

  function peg$parseBooleanLiteral() {
    var s0, s1;

    s0 = peg$currPos;
    if (input.substr(peg$currPos, 4) === peg$c471) {
      s1 = peg$c471;
      peg$currPos += 4;
    } else {
      s1 = peg$FAILED;
      if (peg$silentFails === 0) { peg$fail(peg$c472); }
    }
    if (s1 === peg$FAILED) {
      if (input.substr(peg$currPos, 4) === peg$c473) {
        s1 = peg$c473;
        peg$currPos += 4;
      } else {
        s1 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c474); }
      }
    }
    if (s1 !== peg$FAILED) {
      peg$savedPos = s0;
      s1 = peg$c475();
    }
    s0 = s1;
    if (s0 === peg$FAILED) {
      s0 = peg$currPos;
      if (input.substr(peg$currPos, 5) === peg$c476) {
        s1 = peg$c476;
        peg$currPos += 5;
      } else {
        s1 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c477); }
      }
      if (s1 === peg$FAILED) {
        if (input.substr(peg$currPos, 5) === peg$c478) {
          s1 = peg$c478;
          peg$currPos += 5;
        } else {
          s1 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c479); }
        }
      }
      if (s1 !== peg$FAILED) {
        peg$savedPos = s0;
        s1 = peg$c480();
      }
      s0 = s1;
    }

    return s0;
  }

  function peg$parseString() {
    var s0, s1;

    s0 = peg$currPos;
    s1 = peg$parseSTRING_LITERAL_LONG1();
    if (s1 !== peg$FAILED) {
      peg$savedPos = s0;
      s1 = peg$c481(s1);
    }
    s0 = s1;
    if (s0 === peg$FAILED) {
      s0 = peg$currPos;
      s1 = peg$parseSTRING_LITERAL_LONG2();
      if (s1 !== peg$FAILED) {
        peg$savedPos = s0;
        s1 = peg$c482(s1);
      }
      s0 = s1;
      if (s0 === peg$FAILED) {
        s0 = peg$currPos;
        s1 = peg$parseSTRING_LITERAL1();
        if (s1 !== peg$FAILED) {
          peg$savedPos = s0;
          s1 = peg$c482(s1);
        }
        s0 = s1;
        if (s0 === peg$FAILED) {
          s0 = peg$currPos;
          s1 = peg$parseSTRING_LITERAL2();
          if (s1 !== peg$FAILED) {
            peg$savedPos = s0;
            s1 = peg$c482(s1);
          }
          s0 = s1;
        }
      }
    }

    return s0;
  }

  function peg$parseIRIref() {
    var s0, s1;

    s0 = peg$currPos;
    s1 = peg$parseIRI_REF();
    if (s1 !== peg$FAILED) {
      peg$savedPos = s0;
      s1 = peg$c483(s1);
    }
    s0 = s1;
    if (s0 === peg$FAILED) {
      s0 = peg$currPos;
      s1 = peg$parsePrefixedName();
      if (s1 !== peg$FAILED) {
        peg$savedPos = s0;
        s1 = peg$c484(s1);
      }
      s0 = s1;
    }

    return s0;
  }

  function peg$parsePrefixedName() {
    var s0, s1;

    s0 = peg$currPos;
    s1 = peg$parsePNAME_LN();
    if (s1 !== peg$FAILED) {
      peg$savedPos = s0;
      s1 = peg$c485(s1);
    }
    s0 = s1;
    if (s0 === peg$FAILED) {
      s0 = peg$currPos;
      s1 = peg$parsePNAME_NS();
      if (s1 !== peg$FAILED) {
        peg$savedPos = s0;
        s1 = peg$c486(s1);
      }
      s0 = s1;
    }

    return s0;
  }

  function peg$parseBlankNode() {
    var s0, s1;

    s0 = peg$currPos;
    s1 = peg$parseBLANK_NODE_LABEL();
    if (s1 !== peg$FAILED) {
      peg$savedPos = s0;
      s1 = peg$c487(s1);
    }
    s0 = s1;
    if (s0 === peg$FAILED) {
      s0 = peg$currPos;
      s1 = peg$parseANON();
      if (s1 !== peg$FAILED) {
        peg$savedPos = s0;
        s1 = peg$c488();
      }
      s0 = s1;
    }

    return s0;
  }

  function peg$parseIRI_REF() {
    var s0, s1, s2, s3;

    s0 = peg$currPos;
    if (input.charCodeAt(peg$currPos) === 60) {
      s1 = peg$c294;
      peg$currPos++;
    } else {
      s1 = peg$FAILED;
      if (peg$silentFails === 0) { peg$fail(peg$c295); }
    }
    if (s1 !== peg$FAILED) {
      s2 = [];
      if (peg$c489.test(input.charAt(peg$currPos))) {
        s3 = input.charAt(peg$currPos);
        peg$currPos++;
      } else {
        s3 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c490); }
      }
      while (s3 !== peg$FAILED) {
        s2.push(s3);
        if (peg$c489.test(input.charAt(peg$currPos))) {
          s3 = input.charAt(peg$currPos);
          peg$currPos++;
        } else {
          s3 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c490); }
        }
      }
      if (s2 !== peg$FAILED) {
        if (input.charCodeAt(peg$currPos) === 62) {
          s3 = peg$c296;
          peg$currPos++;
        } else {
          s3 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c297); }
        }
        if (s3 !== peg$FAILED) {
          peg$savedPos = s0;
          s1 = peg$c491(s2);
          s0 = s1;
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }

    return s0;
  }

  function peg$parsePNAME_NS() {
    var s0, s1, s2;

    s0 = peg$currPos;
    s1 = peg$parsePN_PREFIX();
    if (s1 === peg$FAILED) {
      s1 = null;
    }
    if (s1 !== peg$FAILED) {
      if (input.charCodeAt(peg$currPos) === 58) {
        s2 = peg$c492;
        peg$currPos++;
      } else {
        s2 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c493); }
      }
      if (s2 !== peg$FAILED) {
        peg$savedPos = s0;
        s1 = peg$c484(s1);
        s0 = s1;
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }

    return s0;
  }

  function peg$parsePNAME_LN() {
    var s0, s1, s2;

    s0 = peg$currPos;
    s1 = peg$parsePNAME_NS();
    if (s1 !== peg$FAILED) {
      s2 = peg$parsePN_LOCAL();
      if (s2 !== peg$FAILED) {
        peg$savedPos = s0;
        s1 = peg$c494(s1, s2);
        s0 = s1;
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }

    return s0;
  }

  function peg$parseBLANK_NODE_LABEL() {
    var s0, s1, s2;

    s0 = peg$currPos;
    if (input.substr(peg$currPos, 2) === peg$c495) {
      s1 = peg$c495;
      peg$currPos += 2;
    } else {
      s1 = peg$FAILED;
      if (peg$silentFails === 0) { peg$fail(peg$c496); }
    }
    if (s1 !== peg$FAILED) {
      s2 = peg$parsePN_LOCAL();
      if (s2 !== peg$FAILED) {
        peg$savedPos = s0;
        s1 = peg$c497(s2);
        s0 = s1;
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }

    return s0;
  }

  function peg$parseVAR1() {
    var s0, s1, s2;

    s0 = peg$currPos;
    if (input.charCodeAt(peg$currPos) === 63) {
      s1 = peg$c266;
      peg$currPos++;
    } else {
      s1 = peg$FAILED;
      if (peg$silentFails === 0) { peg$fail(peg$c267); }
    }
    if (s1 !== peg$FAILED) {
      s2 = peg$parseVARNAME();
      if (s2 !== peg$FAILED) {
        peg$savedPos = s0;
        s1 = peg$c498(s2);
        s0 = s1;
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }

    return s0;
  }

  function peg$parseVAR2() {
    var s0, s1, s2;

    s0 = peg$currPos;
    if (input.charCodeAt(peg$currPos) === 36) {
      s1 = peg$c499;
      peg$currPos++;
    } else {
      s1 = peg$FAILED;
      if (peg$silentFails === 0) { peg$fail(peg$c500); }
    }
    if (s1 !== peg$FAILED) {
      s2 = peg$parseVARNAME();
      if (s2 !== peg$FAILED) {
        peg$savedPos = s0;
        s1 = peg$c501(s2);
        s0 = s1;
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }

    return s0;
  }

  function peg$parseVAR3() {
    var s0, s1, s2, s3;

    s0 = peg$currPos;
    if (input.substr(peg$currPos, 2) === peg$c502) {
      s1 = peg$c502;
      peg$currPos += 2;
    } else {
      s1 = peg$FAILED;
      if (peg$silentFails === 0) { peg$fail(peg$c503); }
    }
    if (s1 !== peg$FAILED) {
      s2 = peg$parseVARNAME();
      if (s2 !== peg$FAILED) {
        if (input.substr(peg$currPos, 2) === peg$c504) {
          s3 = peg$c504;
          peg$currPos += 2;
        } else {
          s3 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c505); }
        }
        if (s3 !== peg$FAILED) {
          peg$savedPos = s0;
          s1 = peg$c506(s2);
          s0 = s1;
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }

    return s0;
  }

  function peg$parseLANGTAG() {
    var s0, s1, s2, s3, s4, s5, s6, s7;

    s0 = peg$currPos;
    if (input.charCodeAt(peg$currPos) === 64) {
      s1 = peg$c507;
      peg$currPos++;
    } else {
      s1 = peg$FAILED;
      if (peg$silentFails === 0) { peg$fail(peg$c508); }
    }
    if (s1 !== peg$FAILED) {
      s2 = [];
      if (peg$c509.test(input.charAt(peg$currPos))) {
        s3 = input.charAt(peg$currPos);
        peg$currPos++;
      } else {
        s3 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c510); }
      }
      if (s3 !== peg$FAILED) {
        while (s3 !== peg$FAILED) {
          s2.push(s3);
          if (peg$c509.test(input.charAt(peg$currPos))) {
            s3 = input.charAt(peg$currPos);
            peg$currPos++;
          } else {
            s3 = peg$FAILED;
            if (peg$silentFails === 0) { peg$fail(peg$c510); }
          }
        }
      } else {
        s2 = peg$FAILED;
      }
      if (s2 !== peg$FAILED) {
        s3 = [];
        s4 = peg$currPos;
        if (input.charCodeAt(peg$currPos) === 45) {
          s5 = peg$c319;
          peg$currPos++;
        } else {
          s5 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c320); }
        }
        if (s5 !== peg$FAILED) {
          s6 = [];
          if (peg$c511.test(input.charAt(peg$currPos))) {
            s7 = input.charAt(peg$currPos);
            peg$currPos++;
          } else {
            s7 = peg$FAILED;
            if (peg$silentFails === 0) { peg$fail(peg$c512); }
          }
          if (s7 !== peg$FAILED) {
            while (s7 !== peg$FAILED) {
              s6.push(s7);
              if (peg$c511.test(input.charAt(peg$currPos))) {
                s7 = input.charAt(peg$currPos);
                peg$currPos++;
              } else {
                s7 = peg$FAILED;
                if (peg$silentFails === 0) { peg$fail(peg$c512); }
              }
            }
          } else {
            s6 = peg$FAILED;
          }
          if (s6 !== peg$FAILED) {
            s5 = [s5, s6];
            s4 = s5;
          } else {
            peg$currPos = s4;
            s4 = peg$FAILED;
          }
        } else {
          peg$currPos = s4;
          s4 = peg$FAILED;
        }
        while (s4 !== peg$FAILED) {
          s3.push(s4);
          s4 = peg$currPos;
          if (input.charCodeAt(peg$currPos) === 45) {
            s5 = peg$c319;
            peg$currPos++;
          } else {
            s5 = peg$FAILED;
            if (peg$silentFails === 0) { peg$fail(peg$c320); }
          }
          if (s5 !== peg$FAILED) {
            s6 = [];
            if (peg$c511.test(input.charAt(peg$currPos))) {
              s7 = input.charAt(peg$currPos);
              peg$currPos++;
            } else {
              s7 = peg$FAILED;
              if (peg$silentFails === 0) { peg$fail(peg$c512); }
            }
            if (s7 !== peg$FAILED) {
              while (s7 !== peg$FAILED) {
                s6.push(s7);
                if (peg$c511.test(input.charAt(peg$currPos))) {
                  s7 = input.charAt(peg$currPos);
                  peg$currPos++;
                } else {
                  s7 = peg$FAILED;
                  if (peg$silentFails === 0) { peg$fail(peg$c512); }
                }
              }
            } else {
              s6 = peg$FAILED;
            }
            if (s6 !== peg$FAILED) {
              s5 = [s5, s6];
              s4 = s5;
            } else {
              peg$currPos = s4;
              s4 = peg$FAILED;
            }
          } else {
            peg$currPos = s4;
            s4 = peg$FAILED;
          }
        }
        if (s3 !== peg$FAILED) {
          peg$savedPos = s0;
          s1 = peg$c513(s2, s3);
          s0 = s1;
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }

    return s0;
  }

  function peg$parseINTEGER() {
    var s0, s1, s2;

    s0 = peg$currPos;
    s1 = [];
    if (peg$c514.test(input.charAt(peg$currPos))) {
      s2 = input.charAt(peg$currPos);
      peg$currPos++;
    } else {
      s2 = peg$FAILED;
      if (peg$silentFails === 0) { peg$fail(peg$c515); }
    }
    if (s2 !== peg$FAILED) {
      while (s2 !== peg$FAILED) {
        s1.push(s2);
        if (peg$c514.test(input.charAt(peg$currPos))) {
          s2 = input.charAt(peg$currPos);
          peg$currPos++;
        } else {
          s2 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c515); }
        }
      }
    } else {
      s1 = peg$FAILED;
    }
    if (s1 !== peg$FAILED) {
      peg$savedPos = s0;
      s1 = peg$c516(s1);
    }
    s0 = s1;

    return s0;
  }

  function peg$parseDECIMAL() {
    var s0, s1, s2, s3, s4;

    s0 = peg$currPos;
    s1 = [];
    if (peg$c514.test(input.charAt(peg$currPos))) {
      s2 = input.charAt(peg$currPos);
      peg$currPos++;
    } else {
      s2 = peg$FAILED;
      if (peg$silentFails === 0) { peg$fail(peg$c515); }
    }
    if (s2 !== peg$FAILED) {
      while (s2 !== peg$FAILED) {
        s1.push(s2);
        if (peg$c514.test(input.charAt(peg$currPos))) {
          s2 = input.charAt(peg$currPos);
          peg$currPos++;
        } else {
          s2 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c515); }
        }
      }
    } else {
      s1 = peg$FAILED;
    }
    if (s1 !== peg$FAILED) {
      if (input.charCodeAt(peg$currPos) === 46) {
        s2 = peg$c196;
        peg$currPos++;
      } else {
        s2 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c197); }
      }
      if (s2 !== peg$FAILED) {
        s3 = [];
        if (peg$c514.test(input.charAt(peg$currPos))) {
          s4 = input.charAt(peg$currPos);
          peg$currPos++;
        } else {
          s4 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c515); }
        }
        while (s4 !== peg$FAILED) {
          s3.push(s4);
          if (peg$c514.test(input.charAt(peg$currPos))) {
            s4 = input.charAt(peg$currPos);
            peg$currPos++;
          } else {
            s4 = peg$FAILED;
            if (peg$silentFails === 0) { peg$fail(peg$c515); }
          }
        }
        if (s3 !== peg$FAILED) {
          peg$savedPos = s0;
          s1 = peg$c517(s1, s2, s3);
          s0 = s1;
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }
    if (s0 === peg$FAILED) {
      s0 = peg$currPos;
      if (input.charCodeAt(peg$currPos) === 46) {
        s1 = peg$c196;
        peg$currPos++;
      } else {
        s1 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c197); }
      }
      if (s1 !== peg$FAILED) {
        s2 = [];
        if (peg$c514.test(input.charAt(peg$currPos))) {
          s3 = input.charAt(peg$currPos);
          peg$currPos++;
        } else {
          s3 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c515); }
        }
        if (s3 !== peg$FAILED) {
          while (s3 !== peg$FAILED) {
            s2.push(s3);
            if (peg$c514.test(input.charAt(peg$currPos))) {
              s3 = input.charAt(peg$currPos);
              peg$currPos++;
            } else {
              s3 = peg$FAILED;
              if (peg$silentFails === 0) { peg$fail(peg$c515); }
            }
          }
        } else {
          s2 = peg$FAILED;
        }
        if (s2 !== peg$FAILED) {
          peg$savedPos = s0;
          s1 = peg$c518(s1, s2);
          s0 = s1;
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    }

    return s0;
  }

  function peg$parseDOUBLE() {
    var s0, s1, s2, s3, s4;

    s0 = peg$currPos;
    s1 = [];
    if (peg$c514.test(input.charAt(peg$currPos))) {
      s2 = input.charAt(peg$currPos);
      peg$currPos++;
    } else {
      s2 = peg$FAILED;
      if (peg$silentFails === 0) { peg$fail(peg$c515); }
    }
    if (s2 !== peg$FAILED) {
      while (s2 !== peg$FAILED) {
        s1.push(s2);
        if (peg$c514.test(input.charAt(peg$currPos))) {
          s2 = input.charAt(peg$currPos);
          peg$currPos++;
        } else {
          s2 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c515); }
        }
      }
    } else {
      s1 = peg$FAILED;
    }
    if (s1 !== peg$FAILED) {
      if (input.charCodeAt(peg$currPos) === 46) {
        s2 = peg$c196;
        peg$currPos++;
      } else {
        s2 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c197); }
      }
      if (s2 !== peg$FAILED) {
        s3 = [];
        if (peg$c514.test(input.charAt(peg$currPos))) {
          s4 = input.charAt(peg$currPos);
          peg$currPos++;
        } else {
          s4 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c515); }
        }
        while (s4 !== peg$FAILED) {
          s3.push(s4);
          if (peg$c514.test(input.charAt(peg$currPos))) {
            s4 = input.charAt(peg$currPos);
            peg$currPos++;
          } else {
            s4 = peg$FAILED;
            if (peg$silentFails === 0) { peg$fail(peg$c515); }
          }
        }
        if (s3 !== peg$FAILED) {
          s4 = peg$parseEXPONENT();
          if (s4 !== peg$FAILED) {
            peg$savedPos = s0;
            s1 = peg$c519(s1, s2, s3, s4);
            s0 = s1;
          } else {
            peg$currPos = s0;
            s0 = peg$FAILED;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }
    if (s0 === peg$FAILED) {
      s0 = peg$currPos;
      if (input.charCodeAt(peg$currPos) === 46) {
        s1 = peg$c196;
        peg$currPos++;
      } else {
        s1 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c197); }
      }
      if (s1 !== peg$FAILED) {
        s2 = [];
        if (peg$c514.test(input.charAt(peg$currPos))) {
          s3 = input.charAt(peg$currPos);
          peg$currPos++;
        } else {
          s3 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c515); }
        }
        if (s3 !== peg$FAILED) {
          while (s3 !== peg$FAILED) {
            s2.push(s3);
            if (peg$c514.test(input.charAt(peg$currPos))) {
              s3 = input.charAt(peg$currPos);
              peg$currPos++;
            } else {
              s3 = peg$FAILED;
              if (peg$silentFails === 0) { peg$fail(peg$c515); }
            }
          }
        } else {
          s2 = peg$FAILED;
        }
        if (s2 !== peg$FAILED) {
          s3 = peg$parseEXPONENT();
          if (s3 !== peg$FAILED) {
            peg$savedPos = s0;
            s1 = peg$c520(s1, s2, s3);
            s0 = s1;
          } else {
            peg$currPos = s0;
            s0 = peg$FAILED;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
      if (s0 === peg$FAILED) {
        s0 = peg$currPos;
        s1 = [];
        if (peg$c514.test(input.charAt(peg$currPos))) {
          s2 = input.charAt(peg$currPos);
          peg$currPos++;
        } else {
          s2 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c515); }
        }
        if (s2 !== peg$FAILED) {
          while (s2 !== peg$FAILED) {
            s1.push(s2);
            if (peg$c514.test(input.charAt(peg$currPos))) {
              s2 = input.charAt(peg$currPos);
              peg$currPos++;
            } else {
              s2 = peg$FAILED;
              if (peg$silentFails === 0) { peg$fail(peg$c515); }
            }
          }
        } else {
          s1 = peg$FAILED;
        }
        if (s1 !== peg$FAILED) {
          s2 = peg$parseEXPONENT();
          if (s2 !== peg$FAILED) {
            peg$savedPos = s0;
            s1 = peg$c521(s1, s2);
            s0 = s1;
          } else {
            peg$currPos = s0;
            s0 = peg$FAILED;
          }
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      }
    }

    return s0;
  }

  function peg$parseINTEGER_POSITIVE() {
    var s0, s1, s2;

    s0 = peg$currPos;
    if (input.charCodeAt(peg$currPos) === 43) {
      s1 = peg$c268;
      peg$currPos++;
    } else {
      s1 = peg$FAILED;
      if (peg$silentFails === 0) { peg$fail(peg$c269); }
    }
    if (s1 !== peg$FAILED) {
      s2 = peg$parseINTEGER();
      if (s2 !== peg$FAILED) {
        peg$savedPos = s0;
        s1 = peg$c522(s2);
        s0 = s1;
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }

    return s0;
  }

  function peg$parseDECIMAL_POSITIVE() {
    var s0, s1, s2;

    s0 = peg$currPos;
    if (input.charCodeAt(peg$currPos) === 43) {
      s1 = peg$c268;
      peg$currPos++;
    } else {
      s1 = peg$FAILED;
      if (peg$silentFails === 0) { peg$fail(peg$c269); }
    }
    if (s1 !== peg$FAILED) {
      s2 = peg$parseDECIMAL();
      if (s2 !== peg$FAILED) {
        peg$savedPos = s0;
        s1 = peg$c523(s2);
        s0 = s1;
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }

    return s0;
  }

  function peg$parseDOUBLE_POSITIVE() {
    var s0, s1, s2;

    s0 = peg$currPos;
    if (input.charCodeAt(peg$currPos) === 43) {
      s1 = peg$c268;
      peg$currPos++;
    } else {
      s1 = peg$FAILED;
      if (peg$silentFails === 0) { peg$fail(peg$c269); }
    }
    if (s1 !== peg$FAILED) {
      s2 = peg$parseDOUBLE();
      if (s2 !== peg$FAILED) {
        peg$savedPos = s0;
        s1 = peg$c523(s2);
        s0 = s1;
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }

    return s0;
  }

  function peg$parseINTEGER_NEGATIVE() {
    var s0, s1, s2;

    s0 = peg$currPos;
    if (input.charCodeAt(peg$currPos) === 45) {
      s1 = peg$c319;
      peg$currPos++;
    } else {
      s1 = peg$FAILED;
      if (peg$silentFails === 0) { peg$fail(peg$c320); }
    }
    if (s1 !== peg$FAILED) {
      s2 = peg$parseINTEGER();
      if (s2 !== peg$FAILED) {
        peg$savedPos = s0;
        s1 = peg$c524(s2);
        s0 = s1;
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }

    return s0;
  }

  function peg$parseDECIMAL_NEGATIVE() {
    var s0, s1, s2;

    s0 = peg$currPos;
    if (input.charCodeAt(peg$currPos) === 45) {
      s1 = peg$c319;
      peg$currPos++;
    } else {
      s1 = peg$FAILED;
      if (peg$silentFails === 0) { peg$fail(peg$c320); }
    }
    if (s1 !== peg$FAILED) {
      s2 = peg$parseDECIMAL();
      if (s2 !== peg$FAILED) {
        peg$savedPos = s0;
        s1 = peg$c524(s2);
        s0 = s1;
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }

    return s0;
  }

  function peg$parseDOUBLE_NEGATIVE() {
    var s0, s1, s2;

    s0 = peg$currPos;
    if (input.charCodeAt(peg$currPos) === 45) {
      s1 = peg$c319;
      peg$currPos++;
    } else {
      s1 = peg$FAILED;
      if (peg$silentFails === 0) { peg$fail(peg$c320); }
    }
    if (s1 !== peg$FAILED) {
      s2 = peg$parseDOUBLE();
      if (s2 !== peg$FAILED) {
        peg$savedPos = s0;
        s1 = peg$c524(s2);
        s0 = s1;
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }

    return s0;
  }

  function peg$parseEXPONENT() {
    var s0, s1, s2, s3, s4;

    s0 = peg$currPos;
    if (peg$c525.test(input.charAt(peg$currPos))) {
      s1 = input.charAt(peg$currPos);
      peg$currPos++;
    } else {
      s1 = peg$FAILED;
      if (peg$silentFails === 0) { peg$fail(peg$c526); }
    }
    if (s1 !== peg$FAILED) {
      if (peg$c527.test(input.charAt(peg$currPos))) {
        s2 = input.charAt(peg$currPos);
        peg$currPos++;
      } else {
        s2 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c528); }
      }
      if (s2 === peg$FAILED) {
        s2 = null;
      }
      if (s2 !== peg$FAILED) {
        s3 = [];
        if (peg$c514.test(input.charAt(peg$currPos))) {
          s4 = input.charAt(peg$currPos);
          peg$currPos++;
        } else {
          s4 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c515); }
        }
        if (s4 !== peg$FAILED) {
          while (s4 !== peg$FAILED) {
            s3.push(s4);
            if (peg$c514.test(input.charAt(peg$currPos))) {
              s4 = input.charAt(peg$currPos);
              peg$currPos++;
            } else {
              s4 = peg$FAILED;
              if (peg$silentFails === 0) { peg$fail(peg$c515); }
            }
          }
        } else {
          s3 = peg$FAILED;
        }
        if (s3 !== peg$FAILED) {
          peg$savedPos = s0;
          s1 = peg$c529(s1, s2, s3);
          s0 = s1;
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }

    return s0;
  }

  function peg$parseSTRING_LITERAL1() {
    var s0, s1, s2, s3;

    s0 = peg$currPos;
    if (input.charCodeAt(peg$currPos) === 39) {
      s1 = peg$c530;
      peg$currPos++;
    } else {
      s1 = peg$FAILED;
      if (peg$silentFails === 0) { peg$fail(peg$c531); }
    }
    if (s1 !== peg$FAILED) {
      s2 = [];
      if (peg$c532.test(input.charAt(peg$currPos))) {
        s3 = input.charAt(peg$currPos);
        peg$currPos++;
      } else {
        s3 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c533); }
      }
      if (s3 === peg$FAILED) {
        s3 = peg$parseECHAR();
      }
      while (s3 !== peg$FAILED) {
        s2.push(s3);
        if (peg$c532.test(input.charAt(peg$currPos))) {
          s3 = input.charAt(peg$currPos);
          peg$currPos++;
        } else {
          s3 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c533); }
        }
        if (s3 === peg$FAILED) {
          s3 = peg$parseECHAR();
        }
      }
      if (s2 !== peg$FAILED) {
        if (input.charCodeAt(peg$currPos) === 39) {
          s3 = peg$c530;
          peg$currPos++;
        } else {
          s3 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c531); }
        }
        if (s3 !== peg$FAILED) {
          peg$savedPos = s0;
          s1 = peg$c534(s2);
          s0 = s1;
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }

    return s0;
  }

  function peg$parseSTRING_LITERAL2() {
    var s0, s1, s2, s3;

    s0 = peg$currPos;
    if (input.charCodeAt(peg$currPos) === 34) {
      s1 = peg$c535;
      peg$currPos++;
    } else {
      s1 = peg$FAILED;
      if (peg$silentFails === 0) { peg$fail(peg$c536); }
    }
    if (s1 !== peg$FAILED) {
      s2 = [];
      if (peg$c537.test(input.charAt(peg$currPos))) {
        s3 = input.charAt(peg$currPos);
        peg$currPos++;
      } else {
        s3 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c538); }
      }
      if (s3 === peg$FAILED) {
        s3 = peg$parseECHAR();
      }
      while (s3 !== peg$FAILED) {
        s2.push(s3);
        if (peg$c537.test(input.charAt(peg$currPos))) {
          s3 = input.charAt(peg$currPos);
          peg$currPos++;
        } else {
          s3 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c538); }
        }
        if (s3 === peg$FAILED) {
          s3 = peg$parseECHAR();
        }
      }
      if (s2 !== peg$FAILED) {
        if (input.charCodeAt(peg$currPos) === 34) {
          s3 = peg$c535;
          peg$currPos++;
        } else {
          s3 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c536); }
        }
        if (s3 !== peg$FAILED) {
          peg$savedPos = s0;
          s1 = peg$c534(s2);
          s0 = s1;
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }

    return s0;
  }

  function peg$parseSTRING_LITERAL_LONG1() {
    var s0, s1, s2, s3;

    s0 = peg$currPos;
    if (input.substr(peg$currPos, 3) === peg$c539) {
      s1 = peg$c539;
      peg$currPos += 3;
    } else {
      s1 = peg$FAILED;
      if (peg$silentFails === 0) { peg$fail(peg$c540); }
    }
    if (s1 !== peg$FAILED) {
      s2 = [];
      if (peg$c541.test(input.charAt(peg$currPos))) {
        s3 = input.charAt(peg$currPos);
        peg$currPos++;
      } else {
        s3 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c542); }
      }
      if (s3 === peg$FAILED) {
        s3 = peg$parseECHAR();
      }
      while (s3 !== peg$FAILED) {
        s2.push(s3);
        if (peg$c541.test(input.charAt(peg$currPos))) {
          s3 = input.charAt(peg$currPos);
          peg$currPos++;
        } else {
          s3 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c542); }
        }
        if (s3 === peg$FAILED) {
          s3 = peg$parseECHAR();
        }
      }
      if (s2 !== peg$FAILED) {
        if (input.substr(peg$currPos, 3) === peg$c539) {
          s3 = peg$c539;
          peg$currPos += 3;
        } else {
          s3 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c540); }
        }
        if (s3 !== peg$FAILED) {
          peg$savedPos = s0;
          s1 = peg$c534(s2);
          s0 = s1;
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }

    return s0;
  }

  function peg$parseSTRING_LITERAL_LONG2() {
    var s0, s1, s2, s3;

    s0 = peg$currPos;
    if (input.substr(peg$currPos, 3) === peg$c543) {
      s1 = peg$c543;
      peg$currPos += 3;
    } else {
      s1 = peg$FAILED;
      if (peg$silentFails === 0) { peg$fail(peg$c544); }
    }
    if (s1 !== peg$FAILED) {
      s2 = [];
      if (peg$c545.test(input.charAt(peg$currPos))) {
        s3 = input.charAt(peg$currPos);
        peg$currPos++;
      } else {
        s3 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c546); }
      }
      if (s3 === peg$FAILED) {
        s3 = peg$parseECHAR();
      }
      while (s3 !== peg$FAILED) {
        s2.push(s3);
        if (peg$c545.test(input.charAt(peg$currPos))) {
          s3 = input.charAt(peg$currPos);
          peg$currPos++;
        } else {
          s3 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c546); }
        }
        if (s3 === peg$FAILED) {
          s3 = peg$parseECHAR();
        }
      }
      if (s2 !== peg$FAILED) {
        if (input.substr(peg$currPos, 3) === peg$c543) {
          s3 = peg$c543;
          peg$currPos += 3;
        } else {
          s3 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c544); }
        }
        if (s3 !== peg$FAILED) {
          peg$savedPos = s0;
          s1 = peg$c534(s2);
          s0 = s1;
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }

    return s0;
  }

  function peg$parseECHAR() {
    var s0, s1, s2;

    s0 = peg$currPos;
    if (input.charCodeAt(peg$currPos) === 92) {
      s1 = peg$c547;
      peg$currPos++;
    } else {
      s1 = peg$FAILED;
      if (peg$silentFails === 0) { peg$fail(peg$c548); }
    }
    if (s1 !== peg$FAILED) {
      if (peg$c549.test(input.charAt(peg$currPos))) {
        s2 = input.charAt(peg$currPos);
        peg$currPos++;
      } else {
        s2 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c550); }
      }
      if (s2 !== peg$FAILED) {
        s1 = [s1, s2];
        s0 = s1;
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }

    return s0;
  }

  function peg$parseNIL() {
    var s0, s1, s2, s3;

    s0 = peg$currPos;
    if (input.charCodeAt(peg$currPos) === 40) {
      s1 = peg$c27;
      peg$currPos++;
    } else {
      s1 = peg$FAILED;
      if (peg$silentFails === 0) { peg$fail(peg$c28); }
    }
    if (s1 !== peg$FAILED) {
      s2 = [];
      s3 = peg$parseWS();
      while (s3 !== peg$FAILED) {
        s2.push(s3);
        s3 = peg$parseWS();
      }
      if (s2 !== peg$FAILED) {
        if (input.charCodeAt(peg$currPos) === 41) {
          s3 = peg$c33;
          peg$currPos++;
        } else {
          s3 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c34); }
        }
        if (s3 !== peg$FAILED) {
          peg$savedPos = s0;
          s1 = peg$c551();
          s0 = s1;
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }

    return s0;
  }

  function peg$parseWS() {
    var s0;

    if (peg$c552.test(input.charAt(peg$currPos))) {
      s0 = input.charAt(peg$currPos);
      peg$currPos++;
    } else {
      s0 = peg$FAILED;
      if (peg$silentFails === 0) { peg$fail(peg$c553); }
    }
    if (s0 === peg$FAILED) {
      if (peg$c554.test(input.charAt(peg$currPos))) {
        s0 = input.charAt(peg$currPos);
        peg$currPos++;
      } else {
        s0 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c555); }
      }
      if (s0 === peg$FAILED) {
        if (peg$c556.test(input.charAt(peg$currPos))) {
          s0 = input.charAt(peg$currPos);
          peg$currPos++;
        } else {
          s0 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c557); }
        }
        if (s0 === peg$FAILED) {
          if (peg$c558.test(input.charAt(peg$currPos))) {
            s0 = input.charAt(peg$currPos);
            peg$currPos++;
          } else {
            s0 = peg$FAILED;
            if (peg$silentFails === 0) { peg$fail(peg$c559); }
          }
          if (s0 === peg$FAILED) {
            s0 = peg$parseCOMMENT();
          }
        }
      }
    }

    return s0;
  }

  function peg$parseNEW_LINE() {
    var s0;

    if (peg$c560.test(input.charAt(peg$currPos))) {
      s0 = input.charAt(peg$currPos);
      peg$currPos++;
    } else {
      s0 = peg$FAILED;
      if (peg$silentFails === 0) { peg$fail(peg$c561); }
    }

    return s0;
  }

  function peg$parseNON_NEW_LINE() {
    var s0;

    if (peg$c562.test(input.charAt(peg$currPos))) {
      s0 = input.charAt(peg$currPos);
      peg$currPos++;
    } else {
      s0 = peg$FAILED;
      if (peg$silentFails === 0) { peg$fail(peg$c563); }
    }

    return s0;
  }

  function peg$parseHEADER_LINE() {
    var s0, s1, s2, s3, s4;

    s0 = peg$currPos;
    s1 = peg$currPos;
    if (input.charCodeAt(peg$currPos) === 35) {
      s2 = peg$c564;
      peg$currPos++;
    } else {
      s2 = peg$FAILED;
      if (peg$silentFails === 0) { peg$fail(peg$c565); }
    }
    if (s2 !== peg$FAILED) {
      s3 = [];
      s4 = peg$parseNON_NEW_LINE();
      while (s4 !== peg$FAILED) {
        s3.push(s4);
        s4 = peg$parseNON_NEW_LINE();
      }
      if (s3 !== peg$FAILED) {
        s4 = peg$parseNEW_LINE();
        if (s4 !== peg$FAILED) {
          s2 = [s2, s3, s4];
          s1 = s2;
        } else {
          peg$currPos = s1;
          s1 = peg$FAILED;
        }
      } else {
        peg$currPos = s1;
        s1 = peg$FAILED;
      }
    } else {
      peg$currPos = s1;
      s1 = peg$FAILED;
    }
    if (s1 !== peg$FAILED) {
      peg$savedPos = s0;
      s1 = peg$c566(s1);
    }
    s0 = s1;

    return s0;
  }

  function peg$parseCOMMENT() {
    var s0, s1, s2, s3, s4;

    s0 = peg$currPos;
    s1 = peg$currPos;
    if (input.charCodeAt(peg$currPos) === 35) {
      s2 = peg$c564;
      peg$currPos++;
    } else {
      s2 = peg$FAILED;
      if (peg$silentFails === 0) { peg$fail(peg$c565); }
    }
    if (s2 !== peg$FAILED) {
      s3 = [];
      s4 = peg$parseNON_NEW_LINE();
      while (s4 !== peg$FAILED) {
        s3.push(s4);
        s4 = peg$parseNON_NEW_LINE();
      }
      if (s3 !== peg$FAILED) {
        s2 = [s2, s3];
        s1 = s2;
      } else {
        peg$currPos = s1;
        s1 = peg$FAILED;
      }
    } else {
      peg$currPos = s1;
      s1 = peg$FAILED;
    }
    if (s1 !== peg$FAILED) {
      peg$savedPos = s0;
      s1 = peg$c567(s1);
    }
    s0 = s1;

    return s0;
  }

  function peg$parseANON() {
    var s0, s1, s2, s3;

    s0 = peg$currPos;
    if (input.charCodeAt(peg$currPos) === 91) {
      s1 = peg$c276;
      peg$currPos++;
    } else {
      s1 = peg$FAILED;
      if (peg$silentFails === 0) { peg$fail(peg$c277); }
    }
    if (s1 !== peg$FAILED) {
      s2 = [];
      s3 = peg$parseWS();
      while (s3 !== peg$FAILED) {
        s2.push(s3);
        s3 = peg$parseWS();
      }
      if (s2 !== peg$FAILED) {
        if (input.charCodeAt(peg$currPos) === 93) {
          s3 = peg$c278;
          peg$currPos++;
        } else {
          s3 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c279); }
        }
        if (s3 !== peg$FAILED) {
          s1 = [s1, s2, s3];
          s0 = s1;
        } else {
          peg$currPos = s0;
          s0 = peg$FAILED;
        }
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }

    return s0;
  }

  function peg$parsePN_CHARS_BASE() {
    var s0;

    if (peg$c568.test(input.charAt(peg$currPos))) {
      s0 = input.charAt(peg$currPos);
      peg$currPos++;
    } else {
      s0 = peg$FAILED;
      if (peg$silentFails === 0) { peg$fail(peg$c569); }
    }
    if (s0 === peg$FAILED) {
      if (peg$c570.test(input.charAt(peg$currPos))) {
        s0 = input.charAt(peg$currPos);
        peg$currPos++;
      } else {
        s0 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c571); }
      }
      if (s0 === peg$FAILED) {
        if (peg$c572.test(input.charAt(peg$currPos))) {
          s0 = input.charAt(peg$currPos);
          peg$currPos++;
        } else {
          s0 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c573); }
        }
        if (s0 === peg$FAILED) {
          if (peg$c574.test(input.charAt(peg$currPos))) {
            s0 = input.charAt(peg$currPos);
            peg$currPos++;
          } else {
            s0 = peg$FAILED;
            if (peg$silentFails === 0) { peg$fail(peg$c575); }
          }
          if (s0 === peg$FAILED) {
            if (peg$c576.test(input.charAt(peg$currPos))) {
              s0 = input.charAt(peg$currPos);
              peg$currPos++;
            } else {
              s0 = peg$FAILED;
              if (peg$silentFails === 0) { peg$fail(peg$c577); }
            }
            if (s0 === peg$FAILED) {
              if (peg$c578.test(input.charAt(peg$currPos))) {
                s0 = input.charAt(peg$currPos);
                peg$currPos++;
              } else {
                s0 = peg$FAILED;
                if (peg$silentFails === 0) { peg$fail(peg$c579); }
              }
              if (s0 === peg$FAILED) {
                if (peg$c580.test(input.charAt(peg$currPos))) {
                  s0 = input.charAt(peg$currPos);
                  peg$currPos++;
                } else {
                  s0 = peg$FAILED;
                  if (peg$silentFails === 0) { peg$fail(peg$c581); }
                }
                if (s0 === peg$FAILED) {
                  if (peg$c582.test(input.charAt(peg$currPos))) {
                    s0 = input.charAt(peg$currPos);
                    peg$currPos++;
                  } else {
                    s0 = peg$FAILED;
                    if (peg$silentFails === 0) { peg$fail(peg$c583); }
                  }
                  if (s0 === peg$FAILED) {
                    if (peg$c584.test(input.charAt(peg$currPos))) {
                      s0 = input.charAt(peg$currPos);
                      peg$currPos++;
                    } else {
                      s0 = peg$FAILED;
                      if (peg$silentFails === 0) { peg$fail(peg$c585); }
                    }
                    if (s0 === peg$FAILED) {
                      if (peg$c586.test(input.charAt(peg$currPos))) {
                        s0 = input.charAt(peg$currPos);
                        peg$currPos++;
                      } else {
                        s0 = peg$FAILED;
                        if (peg$silentFails === 0) { peg$fail(peg$c587); }
                      }
                      if (s0 === peg$FAILED) {
                        if (peg$c588.test(input.charAt(peg$currPos))) {
                          s0 = input.charAt(peg$currPos);
                          peg$currPos++;
                        } else {
                          s0 = peg$FAILED;
                          if (peg$silentFails === 0) { peg$fail(peg$c589); }
                        }
                        if (s0 === peg$FAILED) {
                          if (peg$c590.test(input.charAt(peg$currPos))) {
                            s0 = input.charAt(peg$currPos);
                            peg$currPos++;
                          } else {
                            s0 = peg$FAILED;
                            if (peg$silentFails === 0) { peg$fail(peg$c591); }
                          }
                          if (s0 === peg$FAILED) {
                            if (peg$c592.test(input.charAt(peg$currPos))) {
                              s0 = input.charAt(peg$currPos);
                              peg$currPos++;
                            } else {
                              s0 = peg$FAILED;
                              if (peg$silentFails === 0) { peg$fail(peg$c593); }
                            }
                            if (s0 === peg$FAILED) {
                              if (peg$c594.test(input.charAt(peg$currPos))) {
                                s0 = input.charAt(peg$currPos);
                                peg$currPos++;
                              } else {
                                s0 = peg$FAILED;
                                if (peg$silentFails === 0) { peg$fail(peg$c595); }
                              }
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }

    return s0;
  }

  function peg$parsePN_CHARS_U() {
    var s0;

    s0 = peg$parsePN_CHARS_BASE();
    if (s0 === peg$FAILED) {
      if (input.charCodeAt(peg$currPos) === 95) {
        s0 = peg$c596;
        peg$currPos++;
      } else {
        s0 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c597); }
      }
    }

    return s0;
  }

  function peg$parseVARNAME() {
    var s0, s1, s2, s3;

    s0 = peg$currPos;
    s1 = peg$parsePN_CHARS_U();
    if (s1 === peg$FAILED) {
      if (peg$c514.test(input.charAt(peg$currPos))) {
        s1 = input.charAt(peg$currPos);
        peg$currPos++;
      } else {
        s1 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c515); }
      }
    }
    if (s1 !== peg$FAILED) {
      s2 = [];
      s3 = peg$parsePN_CHARS_U();
      if (s3 === peg$FAILED) {
        if (peg$c514.test(input.charAt(peg$currPos))) {
          s3 = input.charAt(peg$currPos);
          peg$currPos++;
        } else {
          s3 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c515); }
        }
        if (s3 === peg$FAILED) {
          if (peg$c598.test(input.charAt(peg$currPos))) {
            s3 = input.charAt(peg$currPos);
            peg$currPos++;
          } else {
            s3 = peg$FAILED;
            if (peg$silentFails === 0) { peg$fail(peg$c599); }
          }
          if (s3 === peg$FAILED) {
            if (peg$c600.test(input.charAt(peg$currPos))) {
              s3 = input.charAt(peg$currPos);
              peg$currPos++;
            } else {
              s3 = peg$FAILED;
              if (peg$silentFails === 0) { peg$fail(peg$c601); }
            }
            if (s3 === peg$FAILED) {
              if (peg$c602.test(input.charAt(peg$currPos))) {
                s3 = input.charAt(peg$currPos);
                peg$currPos++;
              } else {
                s3 = peg$FAILED;
                if (peg$silentFails === 0) { peg$fail(peg$c603); }
              }
            }
          }
        }
      }
      while (s3 !== peg$FAILED) {
        s2.push(s3);
        s3 = peg$parsePN_CHARS_U();
        if (s3 === peg$FAILED) {
          if (peg$c514.test(input.charAt(peg$currPos))) {
            s3 = input.charAt(peg$currPos);
            peg$currPos++;
          } else {
            s3 = peg$FAILED;
            if (peg$silentFails === 0) { peg$fail(peg$c515); }
          }
          if (s3 === peg$FAILED) {
            if (peg$c598.test(input.charAt(peg$currPos))) {
              s3 = input.charAt(peg$currPos);
              peg$currPos++;
            } else {
              s3 = peg$FAILED;
              if (peg$silentFails === 0) { peg$fail(peg$c599); }
            }
            if (s3 === peg$FAILED) {
              if (peg$c600.test(input.charAt(peg$currPos))) {
                s3 = input.charAt(peg$currPos);
                peg$currPos++;
              } else {
                s3 = peg$FAILED;
                if (peg$silentFails === 0) { peg$fail(peg$c601); }
              }
              if (s3 === peg$FAILED) {
                if (peg$c602.test(input.charAt(peg$currPos))) {
                  s3 = input.charAt(peg$currPos);
                  peg$currPos++;
                } else {
                  s3 = peg$FAILED;
                  if (peg$silentFails === 0) { peg$fail(peg$c603); }
                }
              }
            }
          }
        }
      }
      if (s2 !== peg$FAILED) {
        peg$savedPos = s0;
        s1 = peg$c604(s1, s2);
        s0 = s1;
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }

    return s0;
  }

  function peg$parsePN_CHARS() {
    var s0;

    s0 = peg$parsePN_CHARS_U();
    if (s0 === peg$FAILED) {
      if (input.charCodeAt(peg$currPos) === 45) {
        s0 = peg$c319;
        peg$currPos++;
      } else {
        s0 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c320); }
      }
      if (s0 === peg$FAILED) {
        if (peg$c514.test(input.charAt(peg$currPos))) {
          s0 = input.charAt(peg$currPos);
          peg$currPos++;
        } else {
          s0 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c515); }
        }
        if (s0 === peg$FAILED) {
          if (peg$c598.test(input.charAt(peg$currPos))) {
            s0 = input.charAt(peg$currPos);
            peg$currPos++;
          } else {
            s0 = peg$FAILED;
            if (peg$silentFails === 0) { peg$fail(peg$c599); }
          }
          if (s0 === peg$FAILED) {
            if (peg$c600.test(input.charAt(peg$currPos))) {
              s0 = input.charAt(peg$currPos);
              peg$currPos++;
            } else {
              s0 = peg$FAILED;
              if (peg$silentFails === 0) { peg$fail(peg$c601); }
            }
            if (s0 === peg$FAILED) {
              if (peg$c602.test(input.charAt(peg$currPos))) {
                s0 = input.charAt(peg$currPos);
                peg$currPos++;
              } else {
                s0 = peg$FAILED;
                if (peg$silentFails === 0) { peg$fail(peg$c603); }
              }
            }
          }
        }
      }
    }

    return s0;
  }

  function peg$parsePN_PREFIX() {
    var s0, s1, s2, s3;

    s0 = peg$currPos;
    s1 = peg$parsePN_CHARS_U();
    if (s1 !== peg$FAILED) {
      s2 = [];
      s3 = peg$parsePN_CHARS();
      if (s3 === peg$FAILED) {
        if (input.charCodeAt(peg$currPos) === 46) {
          s3 = peg$c196;
          peg$currPos++;
        } else {
          s3 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c197); }
        }
      }
      while (s3 !== peg$FAILED) {
        s2.push(s3);
        s3 = peg$parsePN_CHARS();
        if (s3 === peg$FAILED) {
          if (input.charCodeAt(peg$currPos) === 46) {
            s3 = peg$c196;
            peg$currPos++;
          } else {
            s3 = peg$FAILED;
            if (peg$silentFails === 0) { peg$fail(peg$c197); }
          }
        }
      }
      if (s2 !== peg$FAILED) {
        peg$savedPos = s0;
        s1 = peg$c605(s1, s2);
        s0 = s1;
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }

    return s0;
  }

  function peg$parsePN_LOCAL() {
    var s0, s1, s2, s3;

    s0 = peg$currPos;
    if (input.charCodeAt(peg$currPos) === 36) {
      s1 = peg$c499;
      peg$currPos++;
    } else {
      s1 = peg$FAILED;
      if (peg$silentFails === 0) { peg$fail(peg$c500); }
    }
    if (s1 === peg$FAILED) {
      s1 = peg$parsePN_CHARS_U();
      if (s1 === peg$FAILED) {
        if (peg$c514.test(input.charAt(peg$currPos))) {
          s1 = input.charAt(peg$currPos);
          peg$currPos++;
        } else {
          s1 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c515); }
        }
        if (s1 === peg$FAILED) {
          if (input.charCodeAt(peg$currPos) === 58) {
            s1 = peg$c492;
            peg$currPos++;
          } else {
            s1 = peg$FAILED;
            if (peg$silentFails === 0) { peg$fail(peg$c493); }
          }
          if (s1 === peg$FAILED) {
            s1 = peg$parsePLX();
          }
        }
      }
    }
    if (s1 !== peg$FAILED) {
      s2 = [];
      s3 = peg$parsePN_CHARS();
      if (s3 === peg$FAILED) {
        if (input.charCodeAt(peg$currPos) === 46) {
          s3 = peg$c196;
          peg$currPos++;
        } else {
          s3 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c197); }
        }
        if (s3 === peg$FAILED) {
          if (input.charCodeAt(peg$currPos) === 58) {
            s3 = peg$c492;
            peg$currPos++;
          } else {
            s3 = peg$FAILED;
            if (peg$silentFails === 0) { peg$fail(peg$c493); }
          }
          if (s3 === peg$FAILED) {
            s3 = peg$parsePLX();
          }
        }
      }
      while (s3 !== peg$FAILED) {
        s2.push(s3);
        s3 = peg$parsePN_CHARS();
        if (s3 === peg$FAILED) {
          if (input.charCodeAt(peg$currPos) === 46) {
            s3 = peg$c196;
            peg$currPos++;
          } else {
            s3 = peg$FAILED;
            if (peg$silentFails === 0) { peg$fail(peg$c197); }
          }
          if (s3 === peg$FAILED) {
            if (input.charCodeAt(peg$currPos) === 58) {
              s3 = peg$c492;
              peg$currPos++;
            } else {
              s3 = peg$FAILED;
              if (peg$silentFails === 0) { peg$fail(peg$c493); }
            }
            if (s3 === peg$FAILED) {
              s3 = peg$parsePLX();
            }
          }
        }
      }
      if (s2 !== peg$FAILED) {
        peg$savedPos = s0;
        s1 = peg$c606(s1, s2);
        s0 = s1;
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }

    return s0;
  }

  function peg$parsePLX() {
    var s0;

    s0 = peg$parsePERCENT();
    if (s0 === peg$FAILED) {
      s0 = peg$parsePN_LOCAL_ESC();
    }

    return s0;
  }

  function peg$parsePERCENT() {
    var s0, s1, s2, s3, s4;

    s0 = peg$currPos;
    s1 = peg$currPos;
    if (input.charCodeAt(peg$currPos) === 37) {
      s2 = peg$c607;
      peg$currPos++;
    } else {
      s2 = peg$FAILED;
      if (peg$silentFails === 0) { peg$fail(peg$c608); }
    }
    if (s2 !== peg$FAILED) {
      s3 = peg$parseHEX();
      if (s3 !== peg$FAILED) {
        s4 = peg$parseHEX();
        if (s4 !== peg$FAILED) {
          s2 = [s2, s3, s4];
          s1 = s2;
        } else {
          peg$currPos = s1;
          s1 = peg$FAILED;
        }
      } else {
        peg$currPos = s1;
        s1 = peg$FAILED;
      }
    } else {
      peg$currPos = s1;
      s1 = peg$FAILED;
    }
    if (s1 !== peg$FAILED) {
      peg$savedPos = s0;
      s1 = peg$c609(s1);
    }
    s0 = s1;

    return s0;
  }

  function peg$parseHEX() {
    var s0;

    if (peg$c514.test(input.charAt(peg$currPos))) {
      s0 = input.charAt(peg$currPos);
      peg$currPos++;
    } else {
      s0 = peg$FAILED;
      if (peg$silentFails === 0) { peg$fail(peg$c515); }
    }
    if (s0 === peg$FAILED) {
      if (peg$c610.test(input.charAt(peg$currPos))) {
        s0 = input.charAt(peg$currPos);
        peg$currPos++;
      } else {
        s0 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c611); }
      }
      if (s0 === peg$FAILED) {
        if (peg$c612.test(input.charAt(peg$currPos))) {
          s0 = input.charAt(peg$currPos);
          peg$currPos++;
        } else {
          s0 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c613); }
        }
      }
    }

    return s0;
  }

  function peg$parsePN_LOCAL_ESC() {
    var s0, s1, s2;

    s0 = peg$currPos;
    if (input.charCodeAt(peg$currPos) === 92) {
      s1 = peg$c547;
      peg$currPos++;
    } else {
      s1 = peg$FAILED;
      if (peg$silentFails === 0) { peg$fail(peg$c548); }
    }
    if (s1 !== peg$FAILED) {
      if (input.charCodeAt(peg$currPos) === 95) {
        s2 = peg$c596;
        peg$currPos++;
      } else {
        s2 = peg$FAILED;
        if (peg$silentFails === 0) { peg$fail(peg$c597); }
      }
      if (s2 === peg$FAILED) {
        if (input.charCodeAt(peg$currPos) === 126) {
          s2 = peg$c614;
          peg$currPos++;
        } else {
          s2 = peg$FAILED;
          if (peg$silentFails === 0) { peg$fail(peg$c615); }
        }
        if (s2 === peg$FAILED) {
          if (input.charCodeAt(peg$currPos) === 46) {
            s2 = peg$c196;
            peg$currPos++;
          } else {
            s2 = peg$FAILED;
            if (peg$silentFails === 0) { peg$fail(peg$c197); }
          }
          if (s2 === peg$FAILED) {
            if (input.charCodeAt(peg$currPos) === 45) {
              s2 = peg$c319;
              peg$currPos++;
            } else {
              s2 = peg$FAILED;
              if (peg$silentFails === 0) { peg$fail(peg$c320); }
            }
            if (s2 === peg$FAILED) {
              if (input.charCodeAt(peg$currPos) === 33) {
                s2 = peg$c272;
                peg$currPos++;
              } else {
                s2 = peg$FAILED;
                if (peg$silentFails === 0) { peg$fail(peg$c273); }
              }
              if (s2 === peg$FAILED) {
                if (input.charCodeAt(peg$currPos) === 36) {
                  s2 = peg$c499;
                  peg$currPos++;
                } else {
                  s2 = peg$FAILED;
                  if (peg$silentFails === 0) { peg$fail(peg$c500); }
                }
                if (s2 === peg$FAILED) {
                  if (input.charCodeAt(peg$currPos) === 38) {
                    s2 = peg$c616;
                    peg$currPos++;
                  } else {
                    s2 = peg$FAILED;
                    if (peg$silentFails === 0) { peg$fail(peg$c617); }
                  }
                  if (s2 === peg$FAILED) {
                    if (input.charCodeAt(peg$currPos) === 39) {
                      s2 = peg$c530;
                      peg$currPos++;
                    } else {
                      s2 = peg$FAILED;
                      if (peg$silentFails === 0) { peg$fail(peg$c531); }
                    }
                    if (s2 === peg$FAILED) {
                      if (input.charCodeAt(peg$currPos) === 40) {
                        s2 = peg$c27;
                        peg$currPos++;
                      } else {
                        s2 = peg$FAILED;
                        if (peg$silentFails === 0) { peg$fail(peg$c28); }
                      }
                      if (s2 === peg$FAILED) {
                        if (input.charCodeAt(peg$currPos) === 41) {
                          s2 = peg$c33;
                          peg$currPos++;
                        } else {
                          s2 = peg$FAILED;
                          if (peg$silentFails === 0) { peg$fail(peg$c34); }
                        }
                        if (s2 === peg$FAILED) {
                          if (input.charCodeAt(peg$currPos) === 42) {
                            s2 = peg$c35;
                            peg$currPos++;
                          } else {
                            s2 = peg$FAILED;
                            if (peg$silentFails === 0) { peg$fail(peg$c36); }
                          }
                          if (s2 === peg$FAILED) {
                            if (input.charCodeAt(peg$currPos) === 43) {
                              s2 = peg$c268;
                              peg$currPos++;
                            } else {
                              s2 = peg$FAILED;
                              if (peg$silentFails === 0) { peg$fail(peg$c269); }
                            }
                            if (s2 === peg$FAILED) {
                              if (input.charCodeAt(peg$currPos) === 44) {
                                s2 = peg$c239;
                                peg$currPos++;
                              } else {
                                s2 = peg$FAILED;
                                if (peg$silentFails === 0) { peg$fail(peg$c240); }
                              }
                              if (s2 === peg$FAILED) {
                                if (input.charCodeAt(peg$currPos) === 59) {
                                  s2 = peg$c122;
                                  peg$currPos++;
                                } else {
                                  s2 = peg$FAILED;
                                  if (peg$silentFails === 0) { peg$fail(peg$c123); }
                                }
                                if (s2 === peg$FAILED) {
                                  if (input.charCodeAt(peg$currPos) === 58) {
                                    s2 = peg$c492;
                                    peg$currPos++;
                                  } else {
                                    s2 = peg$FAILED;
                                    if (peg$silentFails === 0) { peg$fail(peg$c493); }
                                  }
                                  if (s2 === peg$FAILED) {
                                    if (input.charCodeAt(peg$currPos) === 61) {
                                      s2 = peg$c290;
                                      peg$currPos++;
                                    } else {
                                      s2 = peg$FAILED;
                                      if (peg$silentFails === 0) { peg$fail(peg$c291); }
                                    }
                                    if (s2 === peg$FAILED) {
                                      if (input.charCodeAt(peg$currPos) === 47) {
                                        s2 = peg$c259;
                                        peg$currPos++;
                                      } else {
                                        s2 = peg$FAILED;
                                        if (peg$silentFails === 0) { peg$fail(peg$c260); }
                                      }
                                      if (s2 === peg$FAILED) {
                                        if (input.charCodeAt(peg$currPos) === 63) {
                                          s2 = peg$c266;
                                          peg$currPos++;
                                        } else {
                                          s2 = peg$FAILED;
                                          if (peg$silentFails === 0) { peg$fail(peg$c267); }
                                        }
                                        if (s2 === peg$FAILED) {
                                          if (input.charCodeAt(peg$currPos) === 35) {
                                            s2 = peg$c564;
                                            peg$currPos++;
                                          } else {
                                            s2 = peg$FAILED;
                                            if (peg$silentFails === 0) { peg$fail(peg$c565); }
                                          }
                                          if (s2 === peg$FAILED) {
                                            if (input.charCodeAt(peg$currPos) === 64) {
                                              s2 = peg$c507;
                                              peg$currPos++;
                                            } else {
                                              s2 = peg$FAILED;
                                              if (peg$silentFails === 0) { peg$fail(peg$c508); }
                                            }
                                            if (s2 === peg$FAILED) {
                                              if (input.charCodeAt(peg$currPos) === 37) {
                                                s2 = peg$c607;
                                                peg$currPos++;
                                              } else {
                                                s2 = peg$FAILED;
                                                if (peg$silentFails === 0) { peg$fail(peg$c608); }
                                              }
                                            }
                                          }
                                        }
                                      }
                                    }
                                  }
                                }
                              }
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
      if (s2 !== peg$FAILED) {
        peg$savedPos = s0;
        s1 = peg$c618(s2);
        s0 = s1;
      } else {
        peg$currPos = s0;
        s0 = peg$FAILED;
      }
    } else {
      peg$currPos = s0;
      s0 = peg$FAILED;
    }

    return s0;
  }


    var flattenString = function(arrs) {
      var acum ="";
      for(var i=0; i< arrs.length; i++) {
        if(typeof(arrs[i])==='string') {
          acum = acum + arrs[i];
        } else {
          acum = acum + arrs[i].join('');
        }
      }

      return acum;
    }

    var GlobalBlankNodeCounter = 0;

    var CommentsHash = {};  // For extracting comments

    var prefixes = {};

    var registerPrefix = function(prefix, uri) {
      prefixes[prefix] = uri;
    }

    var registerDefaultPrefix = function(uri) {
      prefixes[null] = uri;
    }

    var arrayToString = function(array) {
      var tmp = "";
      if(array == null)
        return null;

      for(var i=0; i<array.length; i++) {
        tmp = tmp + array[i];
      }

      return tmp.toUpperCase();
    }


  peg$result = peg$startRuleFunction();

  if (peg$result !== peg$FAILED && peg$currPos === input.length) {
    return peg$result;
  } else {
    if (peg$result !== peg$FAILED && peg$currPos < input.length) {
      peg$fail(peg$endExpectation());
    }

    throw peg$buildStructuredError(
      peg$maxFailExpected,
      peg$maxFailPos < input.length ? input.charAt(peg$maxFailPos) : null,
      peg$maxFailPos < input.length
        ? peg$computeLocation(peg$maxFailPos, peg$maxFailPos + 1)
        : peg$computeLocation(peg$maxFailPos, peg$maxFailPos)
    );
  }
}

module.exports = {
  SyntaxError: peg$SyntaxError,
  parse:       peg$parse
};

},{}],3:[function(require,module,exports){
parser = require('./parser.js');
formatter = require('./formatter.js');

exports.reformat = (sparql, indentDepth = 2, debug = false) => {
  var parsedQuery = new parser.parse(sparql);
  if (debug) {
    return(JSON.stringify(parsedQuery, undefined, 2));
  } else {
    return formatter.format(parsedQuery, indentDepth, debug);
  }
};

},{"./formatter.js":1,"./parser.js":2}],4:[function(require,module,exports){
spfmt = require('./spfmt.js');

},{"./spfmt.js":3}]},{},[4]);
