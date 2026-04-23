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

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { grade, classNum, studentNum, studentName } = body;

    if (!grade || !classNum || !studentNum || !studentName) {
      return NextResponse.json({ error: "학생 정보가 필요합니다." }, { status: 400 });
    }

    const doc = await getDoc();
    
    // 1. 자율/진로수정 시트에서 해당 학생의 수정된 데이터 찾기
    const modifiedSheet = doc.sheetsByTitle["자율/진로수정"];
    let modifiedRows: SheetRow[] = [];
    
    if (modifiedSheet) {
      const allRows = await modifiedSheet.getRows();
      modifiedRows = allRows.filter(row => 
        row.get("학년") === String(grade) &&
        row.get("반") === String(classNum) &&
        row.get("번호") === String(studentNum) &&
        row.get("이름") === studentName
      ).map(row => row.toObject() as SheetRow);
    }

    // 2. 추가문구수정 시트에서 해당 학생의 수정된 데이터 찾기
    const recommendationSheet = doc.sheetsByTitle["추가문구수정"];
    let recommendationRows: SheetRow[] = [];
    
    if (recommendationSheet) {
      const allRows = await recommendationSheet.getRows();
      recommendationRows = allRows.filter(row => 
        row.get("학년") === String(grade) &&
        row.get("반") === String(classNum) &&
        row.get("번호") === String(studentNum) &&
        row.get("이름") === studentName
      ).map(row => row.toObject() as SheetRow);
    }

    // 3. 해당 학생의 수정된 데이터 삭제
    if (modifiedSheet && modifiedRows.length > 0) {
      const allRows = await modifiedSheet.getRows();
      for (const row of allRows) {
        if (row.get("학년") === String(grade) &&
            row.get("반") === String(classNum) &&
            row.get("번호") === String(studentNum) &&
            row.get("이름") === studentName) {
          await row.delete();
        }
      }
    }

    if (recommendationSheet && recommendationRows.length > 0) {
      const allRows = await recommendationSheet.getRows();
      for (const row of allRows) {
        if (row.get("학년") === String(grade) &&
            row.get("반") === String(classNum) &&
            row.get("번호") === String(studentNum) &&
            row.get("이름") === studentName) {
          await row.delete();
        }
      }
    }

    return NextResponse.json({ 
      success: true, 
      message: `${studentName} 학생의 수정된 내용이 삭제되었습니다.`,
      restoredModifiedRows: modifiedRows,
      restoredRecommendationRows: recommendationRows
    });

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "알 수 없는 오류가 발생했습니다.";
    console.error("Restore Error:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
