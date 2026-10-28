export function buildMockPack(files) {
  const first = (files && files[0]) || { name: '示例.pptx', kind: 'pptx' };
  const kind = String(first.kind || 'pptx').toLowerCase();
  const locator = { pptx: 'slide 2', pdf: 'page 2', docx: 'section 1' }[kind] || '';

  return {
    title: '模拟课件：学习方法与概念梳理',
    course: '示例课程',
    sourceLanguage: 'English',
    overview: '这是本地联调返回的模拟数据，用来验证页面渲染与交互，不代表真实模型结果。',
    learningGoals: ['能说明本页演示的生成流程', '能识别结构化课件的各个部分'],
    sections: [{
      title: '示例章节',
      summary: '这一节用于演示章节标题、摘要与要点的排版。',
      keyPoints: [{ text: '要点会显示为列表，并附带出处。', sources: [{ file: first.name, locator }] }],
      terms: [{ term: 'study pack', explanation: '学习资料包' }],
      sources: [{ file: first.name, locator }],
    }],
    glossary: [
      { original: 'study pack', translation: '学习资料包', note: '本页生成的结果' },
      { original: 'source', translation: '出处', note: '文件名与页码/幻灯片号' },
    ],
    quiz: [
      {
        type: 'single',
        question: '这份数据是真实模型生成的吗？',
        options: ['是', '不是，是模拟数据'],
        answer: '不是，是模拟数据',
        explanation: '页面上会显示「模拟数据」标记。',
        sources: [{ file: first.name, locator }],
      },
      {
        type: 'short',
        question: '真实生成需要配置什么？',
        options: [],
        answer: 'Cloudflare Worker 的 DEEPSEEK_API_KEY',
        explanation: '密钥只放在 Worker Secret 中。',
        sources: [],
      },
    ],
    sources: [{ file: first.name, locator }],
    warnings: ['这是 AI_MOCK=1 的模拟响应，没有调用真实模型。'],
  };
}
