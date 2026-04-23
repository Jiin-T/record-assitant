import { NextResponse } from "next/server";
import { GoogleSpreadsheet } from "google-spreadsheet";
import { JWT } from "google-auth-library";

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
    const { grade, classNum } = body;

    if (!grade || !classNum) {
      return NextResponse.json({ error: "학년과 반 정보가 필요합니다." }, { status: 400 });
    }

    const doc = await getDoc();
    
    // 1. 자율/진로수정 시트에서 해당 학급의 모든 수정된 데이터 가져오기
    const modifiedSheet = doc.sheetsByTitle["자율/진로수정"];
    const modifiedActivities: Set<string> = new Set();
    
    if (modifiedSheet) {
      const allRows = await modifiedSheet.getRows();
      
      for (const row of allRows) {
        if (row.get("학년") === String(grade) &&
            row.get("반") === String(classNum)) {
          
          const key = `${row.get("번호")}-${row.get("이름")}-${row.get("활동명")}-${row.get("입력영역")}`;
          modifiedActivities.add(key);
        }
      }
    }

    // 2. 추가문구수정 시트에서 해당 학급의 모든 수정된 데이터 가져오기
    const recommendationSheet = doc.sheetsByTitle["추가문구수정"];
    
    if (recommendationSheet) {
      const allRows = await recommendationSheet.getRows();
      
      for (const row of allRows) {
        if (row.get("학년") === String(grade) &&
            row.get("반") === String(classNum)) {
          
          const key = `${row.get("번호")}-${row.get("이름")}-${row.get("활동명")}-${row.get("입력영역")}`;
          modifiedActivities.add(key);
        }
      }
    }

    return NextResponse.json({ 
      modifiedActivities: Array.from(modifiedActivities),
      message: `${modifiedActivities.size}개의 수정된 활동을 찾았습니다.`
    });

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "알 수 없는 오류가 발생했습니다.";
    console.error("Check Modified Batch Error:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
