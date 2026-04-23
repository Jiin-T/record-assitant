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
    const { grade, classNum, studentNum, studentName, activityName, inputArea } = body;

    if (!grade || !classNum || !studentNum || !studentName || !activityName || !inputArea) {
      return NextResponse.json({ error: "필수 정보가 누락되었습니다." }, { status: 400 });
    }

    const doc = await getDoc();
    
    // 1. 자율/진로수정 시트에서 해당 활동의 수정된 데이터 찾기 및 삭제
    const modifiedSheet = doc.sheetsByTitle["자율/진로수정"];
    let deletedRow: SheetRow | null = null;
    
    if (modifiedSheet) {
      await modifiedSheet.loadHeaderRow();
      const allRows = await modifiedSheet.getRows();
      
      for (const row of allRows) {
        if (row.get("학년") === String(grade) &&
            row.get("반") === String(classNum) &&
            row.get("번호") === String(studentNum) &&
            row.get("이름") === studentName &&
            row.get("활동명") === activityName &&
            row.get("입력영역") === inputArea) {
          
          // 삭제할 행 정보 저장
          deletedRow = row.toObject() as SheetRow;
          await row.delete();
          break;
        }
      }
    }

    // 2. 추가문구수정 시트에서 해당 활동 찾기 및 삭제 (추가된 문구인 경우)
    const recommendationSheet = doc.sheetsByTitle["추가문구수정"];
    let deletedRecommendationRow: SheetRow | null = null;
    
    if (recommendationSheet) {
      await recommendationSheet.loadHeaderRow();
      const allRows = await recommendationSheet.getRows();
      
      for (const row of allRows) {
        if (row.get("학년") === String(grade) &&
            row.get("반") === String(classNum) &&
            row.get("번호") === String(studentNum) &&
            row.get("이름") === studentName &&
            row.get("활동명") === activityName &&
            row.get("입력영역") === inputArea) {
          
          // 삭제할 행 정보 저장
          deletedRecommendationRow = row.toObject() as SheetRow;
          await row.delete();
          break;
        }
      }
    }

    if (!deletedRow && !deletedRecommendationRow) {
      return NextResponse.json({ 
        error: "해당 활동의 수정된 데이터를 찾을 수 없습니다." 
      }, { status: 404 });
    }

    return NextResponse.json({ 
      success: true, 
      message: `${activityName} 활동이 원본으로 복원되었습니다.`,
      deletedRow,
      deletedRecommendationRow
    });

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "알 수 없는 오류가 발생했습니다.";
    console.error("Restore Activity Error:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
