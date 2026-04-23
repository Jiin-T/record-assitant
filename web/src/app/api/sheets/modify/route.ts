import { NextResponse } from 'next/server';
import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';

const HEADERS = ['학년', '반', '번호', '이름', '활동명', '입력내용', '입력영역'];

interface ModifiedRow {
  학년: string;
  반: string;
  번호: string;
  이름: string;
  활동명: string;
  입력내용: string;
  입력영역: string;
  // 어느 시트에 저장할지 명시 ('자율/진로수정' | '추가문구수정')
  targetSheet: string;
}

export async function POST(request: Request) {
  try {
    const { modifications }: { modifications: ModifiedRow[] } = await request.json();

    if (!Array.isArray(modifications) || modifications.length === 0) {
      return NextResponse.json({ success: true, updatedRows: 0, addedRows: 0 });
    }

    const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    const key = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');
    const sheetId = process.env.GOOGLE_SHEET_ID;

    if (!email || !key || !sheetId) {
      return NextResponse.json({ error: '환경변수 설정이 누락되었습니다.' }, { status: 500 });
    }

    const jwt = new JWT({ email, key, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
    const doc = new GoogleSpreadsheet(sheetId, jwt);
    await doc.loadInfo();

    // targetSheet별로 그룹화
    const grouped = new Map<string, ModifiedRow[]>();
    for (const row of modifications) {
      const t = row.targetSheet || '자율/진로수정';
      if (!grouped.has(t)) grouped.set(t, []);
      grouped.get(t)!.push(row);
    }

    let totalUpdated = 0;
    let totalAdded = 0;

    for (const [sheetTitle, rows] of grouped) {
      // 시트 가져오기 (없으면 생성)
      let sheet = doc.sheetsByTitle[sheetTitle];
      if (!sheet) {
        sheet = await doc.addSheet({ title: sheetTitle, headerValues: HEADERS });
      }

      const existingRows = await sheet.getRows();

      for (const mod of rows) {
        const match = existingRows.find(r =>
          String(r.get('학년')).trim() === String(mod.학년).trim() &&
          String(r.get('반')).trim() === String(mod.반).trim() &&
          String(r.get('번호')).trim() === String(mod.번호).trim() &&
          String(r.get('이름')).trim() === String(mod.이름).trim() &&
          String(r.get('활동명')).trim() === String(mod.활동명).trim() &&
          String(r.get('입력영역')).trim() === String(mod.입력영역).trim()
        );

        if (match) {
          match.set('입력내용', mod.입력내용);
          await match.save();
          totalUpdated++;
        } else {
          await sheet.addRow({
            학년: mod.학년,
            반: mod.반,
            번호: mod.번호,
            이름: mod.이름,
            활동명: mod.활동명,
            입력내용: mod.입력내용,
            입력영역: mod.입력영역,
          });
          totalAdded++;
        }
      }
    }

    return NextResponse.json({ success: true, updatedRows: totalUpdated, addedRows: totalAdded });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다.';
    console.error('Modify error:', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
