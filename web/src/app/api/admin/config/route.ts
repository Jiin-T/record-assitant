import { NextResponse } from 'next/server';
import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';

const CONFIG_SHEET_TITLE = '설정';
const CONFIG_SHEET_HEADERS = ['항목', '값'];

function verifyAdmin(request: Request): boolean {
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminPassword) return false;
  const auth = request.headers.get('Authorization');
  return auth === `Bearer ${adminPassword}`;
}

async function getDoc() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');
  const sheetId = process.env.GOOGLE_SHEET_ID;

  if (!email || !key || !sheetId) {
    throw new Error('환경변수(.env.local)에 Google API 인증 정보가 누락되었습니다.');
  }

  const jwt = new JWT({ email, key, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
  const doc = new GoogleSpreadsheet(sheetId, jwt);
  await doc.loadInfo();
  return doc;
}

export async function GET(request: Request) {
  if (!verifyAdmin(request)) {
    return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 });
  }

  try {
    const doc = await getDoc();
    const configSheet = doc.sheetsByTitle[CONFIG_SHEET_TITLE];

    if (!configSheet) {
      return NextResponse.json({ config: null });
    }

    const rows = await configSheet.getRows();
    const configRow = rows.find(r => r.get('항목') === '학급구성');

    if (!configRow) {
      return NextResponse.json({ config: null });
    }

    const config = JSON.parse(configRow.get('값') || '{}');
    return NextResponse.json({ config });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  if (!verifyAdmin(request)) {
    return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 });
  }

  try {
    const { config } = await request.json();
    const doc = await getDoc();

    let configSheet = doc.sheetsByTitle[CONFIG_SHEET_TITLE];
    if (!configSheet) {
      configSheet = await doc.addSheet({
        title: CONFIG_SHEET_TITLE,
        headerValues: CONFIG_SHEET_HEADERS,
      });
    }

    const rows = await configSheet.getRows();
    const configRow = rows.find(r => r.get('항목') === '학급구성');
    const configValue = JSON.stringify(config);

    if (configRow) {
      configRow.set('값', configValue);
      await configRow.save();
    } else {
      await configSheet.addRow({ 항목: '학급구성', 값: configValue });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
