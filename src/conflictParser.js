import { splitLines } from "./utils.js";

export function parseConflictFile(content) {
  const normalized = content.replace(/\r\n/g, "\n");
  const trailingNewline = normalized.endsWith("\n");
  const lines = splitLines(normalized);
  if (trailingNewline && lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }
  const segments = [];
  const conflicts = [];
  let textBuffer = [];
  let index = 0;
  let conflictId = 1;

  const flushText = () => {
    if (textBuffer.length === 0) {
      return;
    }
    segments.push({
      type: "text",
      lines: textBuffer
    });
    textBuffer = [];
  };

  while (index < lines.length) {
    const line = lines[index];
    if (!line.startsWith("<<<<<<<")) {
      textBuffer.push(line);
      index += 1;
      continue;
    }

    flushText();
    const startLine = index + 1;
    const oursLabel = line.slice("<<<<<<<".length).trim() || "ours";
    index += 1;

    const oursLines = [];
    while (index < lines.length && !lines[index].startsWith("=======")) {
      oursLines.push(lines[index]);
      index += 1;
    }

    if (index >= lines.length) {
      textBuffer.push("<<<<<<<", ...oursLines);
      break;
    }

    index += 1;
    const theirsLines = [];
    while (index < lines.length && !lines[index].startsWith(">>>>>>>")) {
      theirsLines.push(lines[index]);
      index += 1;
    }

    if (index >= lines.length) {
      textBuffer.push("<<<<<<<", ...oursLines, "=======", ...theirsLines);
      break;
    }

    const theirsLabel = lines[index].slice(">>>>>>>".length).trim() || "theirs";
    const endLine = index + 1;
    index += 1;

    const conflict = {
      type: "conflict",
      id: conflictId,
      startLine,
      endLine,
      oursLabel,
      theirsLabel,
      oursLines,
      theirsLines
    };
    segments.push(conflict);
    conflicts.push(conflict);
    conflictId += 1;
  }

  flushText();

  return {
    segments,
    conflicts,
    trailingNewline
  };
}

export function renderResolvedSegments(segments, trailingNewline = true) {
  const outLines = [];
  for (const segment of segments) {
    if (segment.type === "text") {
      outLines.push(...segment.lines);
      continue;
    }

    if (segment.type === "resolved") {
      outLines.push(...segment.lines);
      continue;
    }

    if (segment.type === "conflict") {
      outLines.push(
        `<<<<<<< ${segment.oursLabel}`,
        ...segment.oursLines,
        "=======",
        ...segment.theirsLines,
        `>>>>>>> ${segment.theirsLabel}`
      );
    }
  }

  const rendered = outLines.join("\n");
  if (!trailingNewline) {
    return rendered;
  }
  if (rendered.length === 0) {
    return "";
  }
  return `${rendered}\n`;
}
