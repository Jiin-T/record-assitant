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

// 현재 시간을 한국 형식으로 포맷팅
function getCurrentTimestamp(): string {
  const now = new Date();
  const koreanTime = new Date(now.getTime() + 9 * 60 * 60 * 1000); // UTC+9
  return koreanTime.toISOString().replace('T', ' ').slice(0, 19);
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { grade, classNum, isIndividual, studentInfo } = body;

    const doc = await getDoc();
    const sheetTitle = `${grade}학년 ${classNum}반`;
    let sheet = doc.sheetsByTitle[sheetTitle];

    if (!sheet) {
      return NextResponse.json({ error: "해당 학급 시트를 찾을 수 없습니다." }, { status: 404 });
    }

    const timestamp = getCurrentTimestamp();

    if (isIndividual && studentInfo) {
      // 개인별 저장 시간 업데이트
      const rows = await sheet.getRows();
      const targetRow = rows.find(
        (row) =>
          row.get("번호") === String(studentInfo.num) &&
          row.get("이름") === studentInfo.name
      );

      if (targetRow) {
        // "저장시간" 열이 없으면 추가
        const headers = sheet.headerValues;
        if (!headers.includes("저장시간")) {
          await sheet.resize({ rowCount: sheet.rowCount, columnCount: sheet.columnCount + 1 });
          await sheet.setHeaderRow([...headers, "저장시간"]);
          
          // 기존 행에 빈 저장시간 값 추가
          const allRows = await sheet.getRows();
          for (const row of allRows) {
            if (!row.get("저장시간")) {
              row.set("저장시간", "");
            }
          }
          await Promise.all(allRows.map(row => row.save()));
        }

        targetRow.set("저장시간", timestamp);
        await targetRow.save();
      } else {
        return NextResponse.json({ error: "해당 학생을 찾을 수 없습니다." }, { status: 404 });
      }
    } else {
      // 학급 전체 저장 시간 업데이트
      const rows = await sheet.getRows();
      
      // "저장시간" 열이 없으면 추가
      const headers = sheet.headerValues;
      if (!headers.includes("저장시간")) {
        await sheet.resize({ rowCount: sheet.rowCount, columnCount: sheet.columnCount + 1 });
        await sheet.setHeaderRow([...headers, "저장시간"]);
      }

      // 모든 학생의 저장시간 업데이트
      for (const row of rows) {
        row.set("저장시간", timestamp);
      }
      await Promise.all(rows.map(row => row.save()));
    }

    return NextResponse.json({ 
      success: true, 
      timestamp,
      message: isIndividual ? "개인별 저장시간이 업데이트되었습니다." : "학급 전체 저장시간이 업데이트되었습니다."
    });

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "알 수 없는 오류가 발생했습니다.";
    console.error("Add Timestamp Error:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
