import { NextResponse } from 'next/server';
import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';

const USER_SHEET_TITLE = '사용자';

export async function POST(request: Request) {
  try {
    const { code } = await request.json();

    if (!code || typeof code !== 'string' || code.trim() === '') {
      return NextResponse.json({ error: '코드를 입력해주세요.' }, { status: 400 });
    }

    const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    const key = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');
    const sheetId = process.env.GOOGLE_SHEET_ID;

    if (!email || !key || !sheetId) {
      return NextResponse.json({ error: '서버 설정 오류가 발생했습니다.' }, { status: 500 });
    }

    const jwt = new JWT({ email, key, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
    const doc = new GoogleSpreadsheet(sheetId, jwt);
    await doc.loadInfo();

    const userSheet = doc.sheetsByTitle[USER_SHEET_TITLE];
    if (!userSheet) {
      return NextResponse.json(
        { error: "'사용자' 시트가 존재하지 않습니다. 관리자에게 문의해주세요." },
        { status: 500 }
      );
    }

    const rows = await userSheet.getRows();
    const matched = rows.find(row => {
      const rowCode = String(row.get('코드') ?? '').trim();
      return rowCode === code.trim();
    });

    if (!matched) {
      return NextResponse.json({ error: '코드가 올바르지 않습니다.' }, { status: 401 });
    }

    const grade = String(matched.get('학년') ?? '').trim();
    const classNum = String(matched.get('반') ?? '').trim();

    if (!grade || !classNum) {
      return NextResponse.json({ error: '시트에 학년 또는 반 정보가 없습니다.' }, { status: 500 });
    }

    return NextResponse.json({ success: true, grade, classNum });
  } catch (error: any) {
    console.error('Class auth error:', error);
    return NextResponse.json({ error: '인증 중 오류가 발생했습니다.' }, { status: 500 });
  }
}
