import { pipeline, type FeatureExtractionPipeline } from '@huggingface/transformers';

// 模型可通过 KG_EMBED_MODEL 覆盖。默认换成多语言模型：
// 上游默认的 all-MiniLM-L6-v2 是纯英文模型，中文笔记的语义检索基本不可用。
// 该模型同为 384 维，与 store.ts 里 vec0(embedding float[384]) 兼容，无需改 schema。
const MODEL = process.env.KG_EMBED_MODEL ?? 'Xenova/multilingual-e5-small';

// e5 系列要求区分查询和文档前缀，否则检索质量明显下降
const NEEDS_E5_PREFIX = /e5/i.test(MODEL);

export class Embedder {
  private extractor: FeatureExtractionPipeline | null = null;

  async init(): Promise<void> {
    // pipeline() 对模型名有字面量重载，传变量会撑爆联合类型（TS2590），故整体转型
    const load = pipeline as unknown as (task: string, model: string, opts: object) => Promise<FeatureExtractionPipeline>;
    this.extractor = await load('feature-extraction', MODEL, { dtype: 'q8' });
  }

  private async run(text: string): Promise<Float32Array> {
    if (!this.extractor) throw new Error('Embedder not initialized. Call init() first.');
    const output = await this.extractor(text, {
      pooling: 'mean',
      normalize: true,
    });
    return new Float32Array(output.tolist()[0] as number[]);
  }

  /** 查询侧嵌入 */
  async embed(text: string): Promise<Float32Array> {
    return this.run(NEEDS_E5_PREFIX ? `query: ${text}` : text);
  }

  /** 索引侧嵌入 */
  async embedDocument(text: string): Promise<Float32Array> {
    return this.run(NEEDS_E5_PREFIX ? `passage: ${text}` : text);
  }

  static get model(): string {
    return MODEL;
  }

  async dispose(): Promise<void> {
    if (this.extractor) {
      await this.extractor.dispose();
      this.extractor = null;
    }
  }

  /**
   * 提取用于嵌入的正文摘要。
   * 上游实现取 content 的第一段，但 Obsidian 笔记普遍以重复标题的 H1 开头，
   * 导致 92% 的笔记嵌入退化成「标题 x2」，语义检索实际只能搜标题。
   * 这里改为：剥掉 markdown 结构标记、跳过与标题重复的首行，累积到 MAX_EXCERPT 字符。
   */
  private static extractExcerpt(content: string, title: string): string {
    const MAX_EXCERPT = 600;
    const norm = (s: string) => s.replace(/[\s#>*`\-_/\\[\]()!:.,，。、|]/g, '');
    const out: string[] = [];
    let len = 0;
    for (const rawLine of content.split('\n')) {
      let line = rawLine.trim();
      if (!line) continue;
      line = line
        .replace(/^>\s?\[![a-zA-Z]+\]\s*/, '')
        .replace(/^>\s?/, '')
        .replace(/^#{1,6}\s*/, '')
        .replace(/^[-*+]\s+/, '')
        .replace(/^\d+\.\s+/, '')
        .replace(/^\|/, '')
        .trim();
      if (!line) continue;
      if (/^[-|:\s]+$/.test(line)) continue;
      if (out.length === 0 && norm(line) === norm(title)) continue;
      out.push(line);
      len += line.length;
      if (len >= MAX_EXCERPT) break;
    }
    return out.join(' ').slice(0, MAX_EXCERPT);
  }

  static buildEmbeddingText(
    title: string,
    tags: string[],
    content: string,
  ): string {
    const parts = [title];
    if (tags.length > 0) {
      parts.push(tags.join(', '));
    }
    const excerpt = Embedder.extractExcerpt(content, title);
    if (excerpt) {
      parts.push(excerpt);
    }
    return parts.join('\n');
  }
}
