import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { text, targetBytes } = body;

    if (!text || typeof text !== 'string') {
      return NextResponse.json({ error: '요약할 텍스트가 없습니다.' }, { status: 400 });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    const model = process.env.GEMINI_MODEL || 'gemini-1.5-flash';

    if (!apiKey) {
      return NextResponse.json({ error: 'AI API 키가 설정되지 않았습니다.' }, { status: 500 });
    }

    const prompt = `
당신은 고등학교 선생님의 학교생활기록부 작성을 돕는 전문가급 AI 조수입니다.
아래는 한 학생의 최종 생기부 내용입니다. 현재 제한 바이트 수(${targetBytes}바이트)를 초과하고 있습니다. (한글은 2바이트, 영문/공백/기호는 1바이트)

가장 중요한 원칙:
1. 학생의 "구체적인 활동 내용(사례, 배우고 느낀 점 등)"과 "핵심 의미"는 절대 훼손되거나 삭제되어서는 안 됩니다.
2. 내용을 지나치게 많이 줄여서 뭉뚱그리지 마세요.
3. 전체 분량이 딱 ${targetBytes}바이트를 넘지 않는 선에서 "최소한으로만" 문맥을 다듬고 불필요한 수식어나 중복 표현만 압축해 주세요. 목표 분량은 ${targetBytes - 20} ~ ${targetBytes}바이트 사이입니다.

요청 사항:
- 요약된 텍스트만 반환하세요. 설명, 부연, JSON 등 다른 내용은 절대 포함하지 마세요.

현재 내용:
${text}
`;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.2 },
        }),
      }
    );

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error?.message || 'AI API 요청에 실패했습니다.');
    }

    const data = await response.json();
    const shortened = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();

    if (!shortened) {
      throw new Error('AI 모델에서 응답을 반환하지 않았습니다.');
    }

    return NextResponse.json({ success: true, shortened });
  } catch (error: any) {
    console.error('AI Shorten Error:', error);
    return NextResponse.json({ error: error.message || '서버 오류가 발생했습니다.' }, { status: 500 });
  }
}
