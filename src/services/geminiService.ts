import { GoogleGenAI, Type } from '@google/genai';

export interface KnowledgeNode {
  node: string;
  children: any[];
}

export interface QuestionAnalysis {
  rawOcrText: string;
  knowledgePoints: string[];
  pitfalls: string[];
  knowledgeTree: KnowledgeNode[];
  summary: string;
  specificMistake: string;
}

export interface KnowledgePointDetails {
  explanation: string;
  exampleQuestion: string;
  exampleSolution: string;
}

async function withRetry<T>(fn: () => Promise<T>, retries = 3, delay = 2000): Promise<T> {
  let lastError: any;
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;
      // Check if it's a transient error (like 500, 503, or the specific RPC error)
      const isTransient = 
        error?.message?.includes('Rpc failed') || 
        error?.message?.includes('500') || 
        error?.message?.includes('503') ||
        error?.message?.includes('fetch failed');
        
      if (!isTransient) throw error;
      
      console.warn(`Gemini API call failed (attempt ${i + 1}/${retries}). Retrying in ${delay}ms...`, error);
      await new Promise(resolve => setTimeout(resolve, delay));
      delay *= 2; // Exponential backoff
    }
  }
  throw lastError;
}

export async function analyzeQuestionImage(base64Image: string, mimeType: string): Promise<QuestionAnalysis> {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  
  const response = await withRetry(async () => {
    return await ai.models.generateContent({
      model: 'gemini-3.1-pro-preview',
      contents: {
        parts: [
          {
            inlineData: {
              data: base64Image,
              mimeType: mimeType,
            },
          },
          {
            text: `你是一位资深的教育专家和学科教师。请分析这张题目图片。

1. **原始OCR文本 (rawOcrText)**：提取图片中原始的文字内容。
2. **知识点提取 (knowledgePoints)**：提取题目考察的核心知识点，确保列表中的每个点都是唯一的。
3. **易错点分析 (pitfalls)**：分析学生在做这道题时最容易掉入的陷阱，确保分析精准且不重复。
4. **知识树构建 (knowledgeTree)**：构建一个层级清晰的知识网络，将相关的知识点、前置知识、衍生知识等内容归类放到一起，展示题目所属的完整知识体系。
5. **题目摘要 (summary)**：用一句话概括题目的核心内容。
6. **错因定位 (specificMistake)**：针对题目中的具体难点或学生可能产生的误解进行深度分析。

请严格遵守 JSON 格式，确保输出内容科学、严谨、无重复。`,
          },
        ],
      },
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            rawOcrText: { type: Type.STRING, description: "图片中原始的OCR识别文本" },
            knowledgePoints: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: "考察知识点列表"
            },
            pitfalls: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: "常见易错点列表"
            },
            knowledgeTree: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  node: { type: Type.STRING, description: "主节点名称" },
                  children: {
                    type: Type.ARRAY,
                    items: { type: Type.STRING },
                    description: "子节点名称列表"
                  }
                },
                required: ["node", "children"]
              },
              description: "相关知识树"
            },
            summary: { type: Type.STRING, description: "题目摘要" },
            specificMistake: { type: Type.STRING, description: "具体错误分析" }
          },
          required: ["rawOcrText", "knowledgePoints", "pitfalls", "knowledgeTree", "summary", "specificMistake"]
        }
      }
    });
  });

  let text = response.text;
  if (!text) {
    throw new Error('No response from Gemini API');
  }
  
  try {
    const parsedData = JSON.parse(text) as QuestionAnalysis;
    return parsedData;
  } catch (e) {
    console.error("Failed to parse JSON response:", text);
    throw new Error("模型返回的格式不正确，请重试。");
  }
}

export async function explainKnowledgePoint(point: string, contextSummary: string): Promise<KnowledgePointDetails> {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  
  const response = await withRetry(async () => {
    return await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: `As an expert educator, strictly explain the knowledge point "${point}" in the context of a question about "${contextSummary}". 
Provide a highly accurate, detailed explanation, one highly relevant example question, and its rigorous step-by-step solution. 
Ensure all content is pedagogically sound, mathematically/scientifically accurate, and free of harmful content. 
Use markdown and LaTeX for math formulas. Respond in professional Chinese.`,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            explanation: { type: Type.STRING, description: "知识点详细讲解，使用Markdown格式" },
            exampleQuestion: { type: Type.STRING, description: "相关例题，使用Markdown格式" },
            exampleSolution: { type: Type.STRING, description: "例题的详细解答步骤，使用Markdown格式" }
          },
          required: ["explanation", "exampleQuestion", "exampleSolution"]
        }
      }
    });
  });

  let text = response.text;
  if (!text) {
    throw new Error('No response from Gemini API');
  }
  
  try {
    return JSON.parse(text) as KnowledgePointDetails;
  } catch (e) {
    console.error("Failed to parse JSON response:", text);
    throw new Error("模型返回的格式不正确，请重试。");
  }
}
