(function () {
  const OPERATORS = ["<=", ">=", "==", "!=", "&&", "||", "+", "-", "*", "/", "%", "^", "<", ">", "!", "?", ":", "(", ")", ","];

  function tokenize(source) {
    const tokens = [];
    let index = 0;
    while (index < source.length) {
      const character = source[index];
      if (/\s/.test(character)) { index++; continue; }
      if (/[0-9.]/.test(character)) {
        const match = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(source.slice(index));
        if (!match) throw new Error(`Bad number at ${index}`);
        tokens.push({ kind: "number", value: parseFloat(match[0]) });
        index += match[0].length;
        continue;
      }
      if (/[A-Za-z_]/.test(character)) {
        const match = /^[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(index));
        tokens.push({ kind: "name", value: match[0] });
        index += match[0].length;
        continue;
      }
      if (character === '"' || character === "'") {
        const end = source.indexOf(character, index + 1);
        if (end < 0) throw new Error("Unclosed text");
        tokens.push({ kind: "string", value: source.slice(index + 1, end) });
        index = end + 1;
        continue;
      }
      const operator = OPERATORS.find((candidate) => source.startsWith(candidate, index));
      if (!operator) throw new Error(`Unexpected "${character}"`);
      tokens.push({ kind: "operator", value: operator });
      index += operator.length;
    }
    return tokens;
  }

  const WORD_OPERATORS = { and: "&&", or: "||", not: "!" };

  function parse(source) {
    const tokens = tokenize(String(source)).map((token) =>
      token.kind === "name" && WORD_OPERATORS[token.value] ? { kind: "operator", value: WORD_OPERATORS[token.value] } : token);
    let position = 0;
    const peek = () => tokens[position];
    const isOperator = (value) => peek() && peek().kind === "operator" && peek().value === value;
    const expect = (value) => {
      if (!isOperator(value)) throw new Error(`Expected "${value}"`);
      position++;
    };
    const binary = (next, operators) => () => {
      let left = next();
      while (peek() && peek().kind === "operator" && operators.includes(peek().value)) {
        const operator = tokens[position++].value;
        left = { node: "binary", operator, left, right: next() };
      }
      return left;
    };

    const primary = () => {
      const token = tokens[position++];
      if (!token) throw new Error("Formula ends too early");
      if (token.kind === "number") return { node: "number", value: token.value };
      if (token.kind === "string") return { node: "string", value: token.value };
      if (token.kind === "name") {
        if (token.value === "true") return { node: "number", value: 1 };
        if (token.value === "false") return { node: "number", value: 0 };
        if (isOperator("(")) {
          position++;
          const args = [];
          if (!isOperator(")")) {
            args.push(expression());
            while (isOperator(",")) { position++; args.push(expression()); }
          }
          expect(")");
          return { node: "call", name: token.value, args };
        }
        return { node: "variable", name: token.value };
      }
      if (token.value === "(") {
        const inner = expression();
        expect(")");
        return inner;
      }
      throw new Error(`Unexpected "${token.value}"`);
    };
    const power = () => {
      const base = primary();
      if (isOperator("^")) { position++; return { node: "binary", operator: "^", left: base, right: unary() }; }
      return base;
    };
    const unary = () => {
      if (isOperator("-") || isOperator("!")) {
        const operator = tokens[position++].value;
        return { node: "unary", operator, operand: unary() };
      }
      return power();
    };
    const multiplicative = binary(unary, ["*", "/", "%"]);
    const additive = binary(multiplicative, ["+", "-"]);
    const comparison = binary(additive, ["<", "<=", ">", ">="]);
    const equality = binary(comparison, ["==", "!="]);
    const logicalAnd = binary(equality, ["&&"]);
    const logicalOr = binary(logicalAnd, ["||"]);
    function expression() {
      const condition = logicalOr();
      if (!isOperator("?")) return condition;
      position++;
      const whenTrue = expression();
      expect(":");
      return { node: "conditional", condition, whenTrue, whenFalse: expression() };
    }

    const tree = expression();
    if (position < tokens.length) throw new Error(`Unexpected "${tokens[position].value}"`);
    return tree;
  }

  const truthy = (value) => (typeof value === "string" ? value.length > 0 : !!value);
  const comparable = (value) => (typeof value === "boolean" ? +value : value);
  const BINARY = {
    "+": (a, b) => a + b, "-": (a, b) => a - b, "*": (a, b) => a * b,
    "/": (a, b) => (b === 0 ? 0 : a / b), "%": (a, b) => (b === 0 ? 0 : a % b), "^": (a, b) => Math.pow(a, b),
    "<": (a, b) => a < b, "<=": (a, b) => a <= b, ">": (a, b) => a > b, ">=": (a, b) => a >= b,
    "==": (a, b) => comparable(a) === comparable(b), "!=": (a, b) => comparable(a) !== comparable(b),
  };

  function build(tree) {
    switch (tree.node) {
      case "number": { const value = tree.value; return () => value; }
      case "string": { const value = tree.value; return () => value; }
      case "variable": {
        const name = tree.name;
        return (scope) => {
          const value = scope.variables[name];
          if (typeof value === "function") return value();
          return value === undefined ? 0 : value;
        };
      }
      case "call": {
        const name = tree.name;
        const args = tree.args.map(build);
        return (scope) => {
          const fn = scope.functions[name];
          if (!fn) throw new Error(`Unknown function ${name}()`);
          return fn(...args.map((arg) => arg(scope)));
        };
      }
      case "unary": {
        const operand = build(tree.operand);
        return tree.operator === "-" ? (scope) => -operand(scope) : (scope) => !truthy(operand(scope));
      }
      case "conditional": {
        const condition = build(tree.condition);
        const whenTrue = build(tree.whenTrue);
        const whenFalse = build(tree.whenFalse);
        return (scope) => (truthy(condition(scope)) ? whenTrue(scope) : whenFalse(scope));
      }
      default: {
        const left = build(tree.left);
        const right = build(tree.right);
        if (tree.operator === "&&") return (scope) => truthy(left(scope)) && truthy(right(scope));
        if (tree.operator === "||") return (scope) => truthy(left(scope)) || truthy(right(scope));
        const apply = BINARY[tree.operator];
        return (scope) => apply(left(scope), right(scope));
      }
    }
  }

  const cache = new Map();

  function compile(formula) {
    if (typeof formula === "number") return () => formula;
    if (typeof formula === "boolean") return () => formula;
    if (formula === undefined || formula === null || formula === "") return null;
    const key = String(formula);
    if (!cache.has(key)) cache.set(key, build(parse(key)));
    return cache.get(key);
  }

  const nameCache = new Map();

  function names(formula) {
    if (typeof formula !== "string") return { variables: new Set(), functions: new Set() };
    if (!nameCache.has(formula)) nameCache.set(formula, collectNames(formula));
    const found = nameCache.get(formula);
    if (found instanceof Error) throw found;
    return found;
  }

  function collectNames(formula) {
    const found = { variables: new Set(), functions: new Set() };
    const walk = (tree) => {
      if (tree.node === "variable") found.variables.add(tree.name);
      if (tree.node === "call") { found.functions.add(tree.name); tree.args.forEach(walk); }
      if (tree.node === "unary") walk(tree.operand);
      if (tree.node === "binary") { walk(tree.left); walk(tree.right); }
      if (tree.node === "conditional") { walk(tree.condition); walk(tree.whenTrue); walk(tree.whenFalse); }
    };
    try { walk(parse(formula)); } catch (error) { return error; }
    return found;
  }

  window.VoxlExpression = { compile, parse, names, truthy };
})();
