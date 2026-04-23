import { NextResponse } from "next/server";
import { GoogleSpreadsheet } from "google-spreadsheet";
import { JWT } from "google-auth-library";

type SheetRow = Record<string, string>;

function getJwt() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n");

  if (!email || !key) {
    throw new Error("Google Sheets 인증 정보가 없습니다.");
  }

  return new JWT({
    email,
    key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
}

function getSheetId() {
  const sheetId = process.env.GOOGLE_SHEET_ID;
  if (!sheetId) {
    throw new Error("GOOGLE_SHEET_ID가 설정되지 않았습니다.");
  }
  return sheetId;
}

async function getDoc() {
  const doc = new GoogleSpreadsheet(getSheetId(), getJwt());
  await doc.loadInfo();
  return doc;
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const grade = searchParams.get("grade");
    const classNum = searchParams.get("classNum");

    if (!grade || !classNum) {
      return NextResponse.json({ error: "학년과 반 정보가 필요합니다." }, { status: 400 });
    }

    const doc = await getDoc();
    const sheetTitle = `${grade}학년 ${classNum}반`;
    const sheet = doc.sheetsByTitle[sheetTitle];

    if (!sheet) {
      return NextResponse.json({ rows: [] });
    }

    const rows = await sheet.getRows();
    const rowData = rows.map((row) => row.toObject() as SheetRow);

    return NextResponse.json({ rows: rowData });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "알 수 없는 오류가 발생했습니다.";
    console.error("Class Data Error:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
