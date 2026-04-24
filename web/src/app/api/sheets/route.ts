import { NextResponse } from "next/server";
import { GoogleSpreadsheet } from "google-spreadsheet";
import { JWT } from "google-auth-library";

type SheetRow = Record<string, string>;

const BASE_ACTIVITY_SHEET_INDEX = 0;
const UPLOAD_SHEET_TITLE = "업로드데이터";
const SHEET1_MOD_TITLE = "자율/진로수정";
const SHEET2_MOD_TITLE = "추가문구수정";
const CONFIG_SHEET_TITLE = "설정";
const RECOMMENDATION_SHEET_TITLE = "추가문구(자율)";
const CLASS_AUTH_SHEET_TITLE = "사용자";

let cachedData: { title: string; activities: SheetRow[]; recommendations: SheetRow[] } | null = null;
let lastFetchTime = 0;
const CACHE_DURATION = 5000;

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

async function getRowsByTitle(doc: GoogleSpreadsheet, title: string): Promise<SheetRow[]> {
  const sheet = doc.sheetsByTitle[title];
  if (!sheet) {
    return [];
  }

  const rows = await sheet.getRows();
  return rows.map((row) => row.toObject() as SheetRow);
}

function normalize(value: unknown) {
  return String(value ?? "").trim();
}

function makeActivityKey(row: SheetRow) {
  return [
    normalize(row["학년"]),
    normalize(row["반"]),
    normalize(row["번호"]),
    normalize(row["이름"]),
    normalize(row["활동명"]),
    normalize(row["입력영역"]),
  ].join("||");
}

function mergeActivityRows(baseRows: SheetRow[], overrideRows: SheetRow[]) {
  const merged = baseRows.map((row) => ({ ...row }));
  const indexByKey = new Map<string, number>();

  merged.forEach((row, index) => {
    indexByKey.set(makeActivityKey(row), index);
  });

  for (const overrideRow of overrideRows) {
    const key = makeActivityKey(overrideRow);
    const existingIndex = indexByKey.get(key);

    if (existingIndex === undefined) {
      indexByKey.set(key, merged.length);
      merged.push({ ...overrideRow });
      continue;
    }

    merged[existingIndex] = {
      ...merged[existingIndex],
      ...overrideRow,
    };
  }

  return merged;
}

function findRecommendationSheet(doc: GoogleSpreadsheet) {
  const explicitSheet = doc.sheetsByTitle[RECOMMENDATION_SHEET_TITLE];
  if (explicitSheet) {
    return explicitSheet;
  }

  const reservedTitles = new Set([
    UPLOAD_SHEET_TITLE,
    SHEET1_MOD_TITLE,
    SHEET2_MOD_TITLE,
    CONFIG_SHEET_TITLE,
    CLASS_AUTH_SHEET_TITLE,
  ]);

  return doc.sheetsByIndex.find(
    (sheet) => sheet.index !== BASE_ACTIVITY_SHEET_INDEX && !reservedTitles.has(sheet.title)
  );
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const forceRefresh = searchParams.get("refresh") === "1";
    const now = Date.now();

    if (!forceRefresh && cachedData && now - lastFetchTime < CACHE_DURATION) {
      return NextResponse.json(cachedData);
    }

    const doc = await getDoc();

    const baseActivitySheet = doc.sheetsByIndex[BASE_ACTIVITY_SHEET_INDEX];
    if (!baseActivitySheet) {
      return NextResponse.json({ error: "기본 활동 시트를 찾지 못했습니다." }, { status: 500 });
    }

    const baseActivityRows = (await baseActivitySheet.getRows()).map((row) => row.toObject() as SheetRow);
    const uploadedRows = await getRowsByTitle(doc, UPLOAD_SHEET_TITLE);
    const sheet1ModifiedRows = await getRowsByTitle(doc, SHEET1_MOD_TITLE);
    const sheet2ModifiedRows = await getRowsByTitle(doc, SHEET2_MOD_TITLE);

    const activityRows = mergeActivityRows(
      [...baseActivityRows, ...uploadedRows],
      [...sheet1ModifiedRows, ...sheet2ModifiedRows]
    );

    const recommendationSheet = findRecommendationSheet(doc);
    const recommendationRows = recommendationSheet
      ? (await recommendationSheet.getRows()).map((row) => row.toObject() as SheetRow)
      : [];

    const responseData = {
      title: doc.title,
      activities: activityRows,
      recommendations: recommendationRows,
    };

    cachedData = responseData;
    lastFetchTime = now;

    return NextResponse.json(responseData);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "알 수 없는 오류가 발생했습니다.";
    console.error("Google Sheets load error:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    const doc = await getDoc();
    const uploadSheet = doc.sheetsByTitle[UPLOAD_SHEET_TITLE];

    if (!uploadSheet) {
      return NextResponse.json({ success: true, message: "업로드 데이터 시트가 없습니다." });
    }

    await uploadSheet.clearRows();

    cachedData = null;
    lastFetchTime = 0;

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "알 수 없는 오류가 발생했습니다.";
    console.error("DELETE Error:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// 현재 시간을 한국 형식으로 포맷팅
function getCurrentTimestamp(): string {
  const now = new Date();
  const koreanTime = new Date(now.getTime() + 9 * 60 * 60 * 1000); // UTC+9
  return koreanTime.toISOString().replace('T', ' ').slice(0, 19);
}

// 새 헤더 목록 (순서/삭제 정보 포함)
const FULL_HEADERS = ["학년", "반", "번호", "이름", "자율활동", "진로활동", "저장시간", "자율순서", "진로순서", "삭제활동"];

async function ensureFullHeaders(sheet: any) {
  await sheet.loadHeaderRow();
  const current: string[] = sheet.headerValues || [];
  const missing = FULL_HEADERS.filter(h => !current.includes(h));
  if (missing.length > 0) {
    await sheet.setHeaderRow([...current, ...missing]);
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { grade, classNum, data } = body;

    const doc = await getDoc();
    const sheetTitle = `${grade}학년 ${classNum}반`;
    let sheet = doc.sheetsByTitle[sheetTitle];

    if (!sheet) {
      sheet = await doc.addSheet({ title: sheetTitle, headerValues: FULL_HEADERS });
    }

    // 헤더 마이그레이션 (기존 시트에 새 컬럼 없을 수 있음)
    await ensureFullHeaders(sheet);

    const timestamp = getCurrentTimestamp();

    if (body.isIndividual && body.studentInfo) {
      const rows = await sheet.getRows();

      // 학생 행 upsert
      const targetRow = rows.find(
        (row) =>
          row.get("번호") === String(body.studentInfo.num) &&
          row.get("이름") === body.studentInfo.name
      );

      const studentData = data[0];
      if (targetRow) {
        targetRow.set("학년", studentData["학년"] ?? "");
        targetRow.set("반", studentData["반"] ?? "");
        targetRow.set("번호", studentData["번호"] ?? "");
        targetRow.set("이름", studentData["이름"] ?? "");
        targetRow.set("자율활동", studentData["자율활동"] ?? "");
        targetRow.set("진로활동", studentData["진로활동"] ?? "");
        targetRow.set("저장시간", timestamp);
        targetRow.set("자율순서", studentData["자율순서"] ?? "");
        targetRow.set("진로순서", studentData["진로순서"] ?? "");
        targetRow.set("삭제활동", studentData["삭제활동"] ?? "");
        await targetRow.save();
      } else {
        await sheet.addRow({ ...studentData, 저장시간: timestamp });
      }

      // __ORDER__ 행 upsert (globalOrders 저장)
      if (body.globalAutoOrder !== undefined || body.globalCareerOrder !== undefined) {
        const orderRow = rows.find((r) => r.get("번호") === "__ORDER__");
        if (orderRow) {
          orderRow.set("자율순서", body.globalAutoOrder ?? "");
          orderRow.set("진로순서", body.globalCareerOrder ?? "");
          await orderRow.save();
        } else {
          await sheet.addRow({
            학년: String(grade), 반: String(classNum), 번호: "__ORDER__",
            이름: "", 자율활동: "", 진로활동: "", 저장시간: "",
            자율순서: body.globalAutoOrder ?? "",
            진로순서: body.globalCareerOrder ?? "",
            삭제활동: "",
          });
        }
      }
    } else {
      // 전체 저장: clearRows → addRows (__ORDER__ 행 포함해서 frontend가 payload에 넣음)
      await sheet.clearRows();
      await sheet.setHeaderRow(FULL_HEADERS);

      const dataWithTimestamp = data.map((row: any) => ({
        ...row,
        저장시간: row["번호"] === "__ORDER__" ? "" : timestamp,
      }));

      await sheet.addRows(dataWithTimestamp);
    }

    cachedData = null;
    lastFetchTime = 0;

    return NextResponse.json({ 
      success: true, 
      sheetTitle,
      timestamp,
      message: body.isIndividual ? "개인별 데이터가 저장되었습니다." : "학급 전체 데이터가 저장되었습니다."
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "알 수 없는 오류가 발생했습니다.";
    console.error("POST Error:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
