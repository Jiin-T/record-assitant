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
    return NextResponse.json({ error: '환경변수 설정이 누락되었습니다.' }, { status: 500 });
  }

  try {
    const jwt = new JWT({ email, key, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
    const doc = new GoogleSpreadsheet(sheetId, jwt);
    await doc.loadInfo();

    const uploadSheet = doc.sheetsByTitle['업로드데이터'];
    if (!uploadSheet) {
      return NextResponse.json({ rows: [], total: 0 });
    }

    const rows = await uploadSheet.getRows();
    const data = rows.map((row: any) => ({
      학년: row.get('학년') || '',
      반: row.get('반') || '',
      번호: row.get('번호') || '',
      이름: row.get('이름') || '',
      활동명: row.get('활동명') || '',
      입력내용: row.get('입력내용') || '',
      입력영역: row.get('입력영역') || '',
    }));

    return NextResponse.json({ rows: data, total: data.length });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  if (!verifyAdmin(request)) {
    return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 });
  }

  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');
  const sheetId = process.env.GOOGLE_SHEET_ID;

  if (!email || !key || !sheetId) {
    return NextResponse.json({ error: '환경변수 설정이 누락되었습니다.' }, { status: 500 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const grade = searchParams.get('grade');
    const classNum = searchParams.get('class');

    const jwt = new JWT({ email, key, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
    const doc = new GoogleSpreadsheet(sheetId, jwt);
    await doc.loadInfo();

    const uploadSheet = doc.sheetsByTitle['업로드데이터'];
    if (!uploadSheet) {
      return NextResponse.json({ success: true, deletedRows: 0 });
    }

    if (!grade && !classNum) {
      await uploadSheet.clearRows();
      return NextResponse.json({ success: true, deletedRows: -1, message: '전체 업로드 이력이 삭제되었습니다.' });
    }

    const rows = await uploadSheet.getRows();
    const toDelete = rows.filter((r: any) => {
      if (grade && r.get('학년') !== grade) return false;
      if (classNum && r.get('반') !== classNum) return false;
      return true;
    });

    for (const row of toDelete) {
      await row.delete();
    }

    return NextResponse.json({ success: true, deletedRows: toDelete.length });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
