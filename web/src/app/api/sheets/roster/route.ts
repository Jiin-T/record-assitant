import { NextResponse } from "next/server";
import { GoogleSpreadsheet } from "google-spreadsheet";
import { JWT } from "google-auth-library";

type SheetRow = Record<string, string>;

const ROSTER_SHEET_TITLE = "학생명렬";

function getJwt() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (!email || !key) throw new Error("Google Sheets 인증 정보가 없습니다.");
  return new JWT({
    email,
    key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
}

function getSheetId() {
  const sheetId = process.env.GOOGLE_SHEET_ID;
  if (!sheetId) throw new Error("GOOGLE_SHEET_ID가 설정되지 않았습니다.");
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
      return NextResponse.json(
        { error: "학년과 반 정보가 필요합니다." },
        { status: 400 }
      );
    }

    const doc = await getDoc();
    const sheet = doc.sheetsByTitle[ROSTER_SHEET_TITLE];

    if (!sheet) {
      // 시트가 없으면 빈 배열 반환 (오류 없이)
      return NextResponse.json({ students: [] });
    }

    const rows = await sheet.getRows();
    const rawRows = rows.map((row) => row.toObject() as SheetRow);

    // 학년·반 필터링 후 학생 목록 생성
    // 컬럼명은 유연하게 처리: 번호 또는 학번, 학년, 반, 이름
    const students = rawRows
      .filter((row) => {
        const rowGrade = String(row["학년"] ?? "").trim();
        const rowClass = String(row["반"] ?? "").trim();
        return rowGrade === String(grade) && rowClass === String(classNum);
      })
      .map((row) => {
        const num = String(row["번호"] ?? row["학번"] ?? "").trim();
        const name = String(row["이름"] ?? "").trim();
        return { num, name };
      })
      .filter((s) => s.num && s.name);

    return NextResponse.json({ students });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "알 수 없는 오류가 발생했습니다.";
    console.error("Roster API Error:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
