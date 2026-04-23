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
    const { grade, classNum, studentNum, studentName, activityName, inputArea } = body;

    if (!grade || !classNum || !studentNum || !studentName || !activityName || !inputArea) {
      return NextResponse.json({ error: "필수 정보가 누락되었습니다." }, { status: 400 });
    }

    const doc = await getDoc();
    
    // 추가문구(자율) 시트에서 원본 데이터 찾기
    const recommendationSheet = doc.sheetsByTitle["추가문구(자율)"];
    
    if (!recommendationSheet) {
      return NextResponse.json({ 
        success: false, 
        error: "추가문구(자율) 시트를 찾을 수 없습니다." 
      }, { status: 404 });
    }

    const allRows = await recommendationSheet.getRows();
    let original = null;
    
    for (const row of allRows) {
      if (row.get("활동명") === activityName) {
        original = {
          활동명: row.get("활동명"),
          활동내용: row.get("활동내용"),
          입력영역: inputArea,
          원본시트: "추가문구(자율)"
        };
        break;
      }
    }

    if (!original) {
      return NextResponse.json({ 
        success: false, 
        error: "해당 활동의 원본을 찾을 수 없습니다." 
      }, { status: 404 });
    }

    return NextResponse.json({ 
      success: true, 
      original,
      message: "추가문구 원본을 찾았습니다."
    });

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "알 수 없는 오류가 발생했습니다.";
    console.error("Get Recommendation Original Error:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
