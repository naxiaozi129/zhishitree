export function chatCompletionsUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/$/, '');
  if (trimmed.endsWith('/chat/completions')) return trimmed;
  return `${trimmed}/chat/completions`;
}

function extractTextFromContent(content: unknown): string {
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part && typeof part === 'object') {
          const p = part as { text?: unknown; content?: unknown };
          if (typeof p.text === 'string') return p.text;
          if (typeof p.content === 'string') return p.content;
        }
        return '';
      })
      .join('')
      .trim();
  }
  return '';
}

export function extractOpenAiResponseText(data: unknown): { text: string; finishReason?: string } {
  const root = data as Record<string, unknown>;
  if (root.error && typeof root.error === 'object') {
    const err = root.error as { message?: string; code?: string };
    throw new Error(err.message || err.code || 'API 返回错误');
  }

  const choices = Array.isArray(root.choices) ? root.choices : [];
  const choice = choices[0] as Record<string, unknown> | undefined;
  if (!choice) return { text: '' };

  const finishReason = typeof choice.finish_reason === 'string' ? choice.finish_reason : undefined;
  const message = choice.message as Record<string, unknown> | undefined;

  if (message) {
    const content = extractTextFromContent(message.content);
    if (content) return { text: content, finishReason };
    const reasoning =
      typeof message.reasoning_content === 'string' ? message.reasoning_content.trim() : '';
    if (reasoning) return { text: reasoning, finishReason };
  }

  const legacy = typeof choice.text === 'string' ? choice.text.trim() : '';
  if (legacy) return { text: legacy, finishReason };

  return { text: '', finishReason };
}
