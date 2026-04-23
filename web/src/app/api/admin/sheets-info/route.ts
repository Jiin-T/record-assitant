import { NextResponse } from 'next/server';
import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';

function verifyAdmin(request: Request): boolean {
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminPassword) return false;
  const auth = request.headers.get('Authorization');
  return auth === `Bearer ${adminPassword}`;
}

export async function GET(request: Request) {
  if (!verifyAdmin(request)) {
    return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 });
  }

  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');
  const sheetId = process.env.GOOGLE_SHEET_ID;

  if (!email || !key || !sheetId) {
    return NextResponse.json({
      connected: false,
      error: '환경변수(.env.local)에 Google API 인증 정보가 누락되었습니다.',
      sheetId: null,
      email: null,
      sheets: [],
    });
  }

  try {
    const jwt = new JWT({ email, key, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
    const doc = new GoogleSpreadsheet(sheetId, jwt);
    await Promise.race([
      doc.loadInfo(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Google Sheets 연결 시간 초과 (10초)')), 10000)
      ),
    ]);

    const sheets = doc.sheetsByIndex.map((s: any) => ({
      title: s.title,
      index: s.index,
      rowCount: s.rowCount,
      columnCount: s.columnCount,
    }));

    const maskedId = sheetId.length > 8
      ? `${sheetId.slice(0, 4)}...${sheetId.slice(-4)}`
      : '****';

    return NextResponse.json({
      connected: true,
      title: doc.title,
      sheetId: maskedId,
      email,
      sheets,
    });
  } catch (error: any) {
    const maskedId = sheetId.length > 8
      ? `${sheetId.slice(0, 4)}...${sheetId.slice(-4)}`
      : '****';
    return NextResponse.json({
      connected: false,
      error: error.message,
      sheetId: maskedId,
      email,
      sheets: [],
    });
  }
}
