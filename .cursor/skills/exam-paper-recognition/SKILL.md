---
name: exam-paper-recognition
description: >-
  识别试卷/错题图片中的题干、选项、表格与配图。使用 MinerU VLM OCR + 试卷排版流水线（拆题、选项分行、题答分离）。
  在 zhishitree 错题上传、试卷导入、OCR 展示时自动适用。
disable-model-invocation: true
---

# 试卷 / 错题识别（exam-paper-recognition）

## 何时使用

- 用户上传 **单道错题照片** 或 **试卷截图** 需要 OCR
- 需要 **表格、公式、电路图** 与 **选择题选项分行** 展示
- 禁止用 LLM「改写」OCR 原文（除非 `AI_OCR_LLM_CORRECT=1` 且 MinerU 质量不足）

## 运行时入口（代码）

错题上传分析时，服务端 **必须** 调用：

```ts
import { recognizeExamPaperImage } from 'server/examPaperRecognition.ts';
```

该函数 = MinerU VLM OCR → 表格/配图 → `applyExamPaperRecognitionPipeline`。

返回 `meta.pipeline === 'exam-paper-recognition'` 会写入 `analysis.ocrMeta`，前端显示识别方式。

**注意**：本 SKILL.md 指导 Cursor Agent 开发；网页运行时由 `recognizeExamPaperImage()` 执行，不是 Agent 读此文后手动识别。

## 流水线（代码入口）

| 步骤 | 模块 | 说明 |
|------|------|------|
| 1. 图像 OCR | `server/mineruOcr.ts` | 优先 MinerU `vlm-auto-engine`；失败可云端 Agent |
| 2. 配图/表格 | `server/examFigureExtract.ts` | HTML 表→Markdown；嵌入 `fig-circuit` 占位符 |
| 3. 试卷正文排版 | `server/examPaperRecognition.ts` | `applyExamPaperRecognitionPipeline` |
| 4. 选项分行 | `shared/formatMcq.ts` | 题干与 A/B/C/D 分行；保留「A、B两测力计」类题干 |
| 5. 题答分离 | `server/examContentSplit.ts` | `【答案及解析】` 等标记拆分 |
| 6. 分析 | `server/questionImageAnalyze.ts` | OCR 文本 → 知识点/错因 JSON |
| 7. 前端展示 | `ExamPaperView` + `MarkdownRenderer` | 无表格用试卷式；有 Markdown 表用 GFM |

## MinerU 配置

```env
MINERU_API_URL=http://127.0.0.1:8000
MINERU_BACKEND=vlm-auto-engine
AI_OCR_LLM_CORRECT=0
MINERU_OCR_FALLBACK_VISION=0
```

本机 API：`mineru-api --host 0.0.0.0 --port 8000 --enable-vlm-preload true`

## OCR 硬性要求（写入 `buildOcrPrompt`）

1. 题号、标点、单位原样保留（Ω、A、V 勿混淆）
2. 表格必须完整 Markdown 表格
3. 电路图：文字描述连接关系，或 `[电路图见原题配图]`
4. **选择题**：题干与选项分开；每个选项单独一行

## 前端展示规则

- 含 `| ... |` Markdown 表格 → `MarkdownRenderer` + `highlightMcqOptions`
- 否则 → `ExamPaperView`（选项左缩进、逐行显示）
- 配图由 `resolveCircuitImageUri` 回退上传原图，避免 localStorage 裂图

## 修改识别逻辑时

1. 先改 `shared/formatMcq.ts` 或 `server/examPaperRecognition.ts`
2. 运行 `npx vitest run shared/formatMcq.test.ts`
3. `npm run build` 并重启 8787 服务
