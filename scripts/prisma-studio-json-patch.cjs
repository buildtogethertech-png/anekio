// Prisma Studio 0.511 JSON.parse's request bodies. Some requests are already objects,
// which throws: SyntaxError: "[object Object]" is not valid JSON
const parse = JSON.parse;
JSON.parse = function prismaStudioJsonParse(text, reviver) {
  if (text != null && typeof text === "object") return text;
  return parse.call(this, text, reviver);
};
