function extractTextFromResponse(payload) {
  if (typeof payload.output_text === "string" && payload.output_text.length > 0) {
    return payload.output_text;
  }

  if (!Array.isArray(payload.output)) {
    return "";
  }

  const parts = [];
  for (const item of payload.output) {
    if (!item || !Array.isArray(item.content)) {
      continue;
    }
    for (const content of item.content) {
      if (content.type === "output_text" || content.type === "text") {
        parts.push(content.text ?? "");
      }
    }
  }
  return parts.join("\n").trim();
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    const firstBrace = text.indexOf("{");
    const lastBrace = text.lastIndexOf("}");
    if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
      return null;
    }
    try {
      return JSON.parse(text.slice(firstBrace, lastBrace + 1));
    } catch {
      return null;
    }
  }
}

export function createAIResolver({ enabled, apiKey, model }) {
  if (!enabled || !apiKey) {
    return null;
  }

  return async function aiResolveBlock({ filePath, block }) {
    const prompt = [
      "Resolve this Git merge conflict block.",
      "Return strict JSON with keys: resolved_code (string), confidence (0..1), reason (string).",
      "Do not include markdown fences or extra keys.",
      "",
      `File: ${filePath}`,
      `Conflict block id: ${block.id}`,
      `OURS (${block.oursLabel}):`,
      block.oursLines.join("\n"),
      "",
      `THEIRS (${block.theirsLabel}):`,
      block.theirsLines.join("\n")
    ].join("\n");

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        temperature: 0.1,
        max_output_tokens: 700,
        input: [
          {
            role: "system",
            content:
              "You are a conservative merge conflict resolver. Prefer deterministic combinations. Never invent APIs."
          },
          {
            role: "user",
            content: prompt
          }
        ]
      })
    });

    if (!response.ok) {
      return null;
    }

    const payload = await response.json();
    const rawText = extractTextFromResponse(payload);
    const parsed = safeJsonParse(rawText);
    if (!parsed || typeof parsed.resolved_code !== "string") {
      return null;
    }

    return {
      lines: parsed.resolved_code.replace(/\r\n/g, "\n").split("\n"),
      confidence:
        typeof parsed.confidence === "number" && Number.isFinite(parsed.confidence)
          ? Math.max(0, Math.min(1, parsed.confidence))
          : 0.65,
      reason:
        typeof parsed.reason === "string" && parsed.reason.trim()
          ? parsed.reason.trim()
          : "Resolved via AI fallback."
    };
  };
}

