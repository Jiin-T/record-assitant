"use client";

import { useState, useRef, useCallback } from "react";
import * as XLSX from "xlsx";

interface UploadRow {
  학년: string;
  반: string;
  번호: string;
  이름: string;
  자율활동명: string;
  자율활동: string;
  진로활동명: string;
  진로활동: string;
}

interface UploadModalProps {
  onClose: () => void;
  onSuccess: () => void;
}

const REQUIRED_COLUMNS = ["학년", "반", "번호", "이름", "자율활동명", "자율활동", "진로활동명", "진로활동"];

function downloadTemplate() {
  const wb = XLSX.utils.book_new();
  const sampleData = [
    { 학년: 2, 반: 1, 번호: 1, 이름: "홍길동", 자율활동명: "학생자치회", 자율활동: "자율활동 내용을 입력하세요.", 진로활동명: "진로수업", 진로활동: "진로활동 내용을 입력하세요." },
    { 학년: 2, 반: 1, 번호: 2, 이름: "김철수", 자율활동명: "", 자율활동: "", 진로활동명: "", 진로활동: "" },
  ];
  const ws = XLSX.utils.json_to_sheet(sampleData, { header: REQUIRED_COLUMNS });
  // 열 너비 설정
  ws["!cols"] = [{ wch: 6 }, { wch: 6 }, { wch: 6 }, { wch: 10 }, { wch: 14 }, { wch: 36 }, { wch: 14 }, { wch: 36 }];
  XLSX.utils.book_append_sheet(wb, ws, "활동데이터");
  XLSX.writeFile(wb, "활동데이터_업로드_템플릿.xlsx");
}

export default function UploadModal({ onClose, onSuccess }: UploadModalProps) {
  const [parsedRows, setParsedRows] = useState<UploadRow[]>([]);
  const [fileName, setFileName] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<{ addedRows: number; deletedRows: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const parseFile = useCallback((file: File) => {
    setError(null);
    setParsedRows([]);
    setUploadResult(null);
    setFileName(file.name);

    const ext = file.name.split(".").pop()?.toLowerCase();
    if (!["xlsx", "xls", "csv"].includes(ext || "")) {
      setError("xlsx, xls, csv 파일만 업로드 가능합니다.");
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = e.target?.result;
        const workbook = XLSX.read(data, { type: "binary" });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const json: any[] = XLSX.utils.sheet_to_json(sheet, { defval: "" });

        if (json.length === 0) {
          setError("파일에 데이터가 없습니다.");
          return;
        }

        const headers = Object.keys(json[0]);
        const missing = REQUIRED_COLUMNS.filter((col) => !headers.includes(col));
        if (missing.length > 0) {
          setError(`필수 열이 없습니다: ${missing.join(", ")}\n필요한 열: ${REQUIRED_COLUMNS.join(", ")}`);
          return;
        }

        const rows: UploadRow[] = json.map((row) => ({
          학년: String(row["학년"] ?? ""),
          반: String(row["반"] ?? ""),
          번호: String(row["번호"] ?? ""),
          이름: String(row["이름"] ?? ""),
          자율활동명: String(row["자율활동명"] ?? ""),
          자율활동: String(row["자율활동"] ?? ""),
          진로활동명: String(row["진로활동명"] ?? ""),
          진로활동: String(row["진로활동"] ?? ""),
        })).filter((r) => r.이름.trim() !== "");

        if (rows.length === 0) {
          setError("유효한 학생 데이터가 없습니다.");
          return;
        }

        setParsedRows(rows);
      } catch {
        setError("파일 파싱 중 오류가 발생했습니다. 파일 형식을 확인해주세요.");
      }
    };
    reader.readAsBinaryString(file);
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) parseFile(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) parseFile(file);
  };

  const handleUpload = async () => {
    if (parsedRows.length === 0) return;
    setIsUploading(true);
    setError(null);
    try {
      const res = await fetch("/api/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: parsedRows }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error);
      setUploadResult(result);
      onSuccess();
    } catch (err: any) {
      setError("업로드 중 오류가 발생했습니다: " + err.message);
    } finally {
      setIsUploading(false);
    }
  };

  // 학급별 요약
  const classSummary = parsedRows.reduce<Record<string, number>>((acc, r) => {
    const key = `${r.학년}학년 ${r.반}반`;
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden border border-gray-100">

        {/* Header */}
        <div className="p-5 border-b border-gray-200 flex justify-between items-center bg-gray-50/80">
          <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2">
            📂 활동 데이터 업로드
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-800 font-bold text-2xl transition-colors">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-4">

          {/* 엑셀 형식 안내 */}
          <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 text-sm text-blue-800">
            <p className="font-semibold mb-2">📋 업로드 파일 형식 (Excel / CSV)</p>
            <div className="overflow-x-auto">
              <table className="text-xs border-collapse w-full">
                <thead>
                  <tr className="bg-blue-100">
                    {REQUIRED_COLUMNS.map((col) => (
                      <th key={col} className="border border-blue-200 px-3 py-1.5 font-semibold">{col}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr className="bg-white">
                    <td className="border border-blue-200 px-3 py-1 text-gray-500">2</td>
                    <td className="border border-blue-200 px-3 py-1 text-gray-500">1</td>
                    <td className="border border-blue-200 px-3 py-1 text-gray-500">1</td>
                    <td className="border border-blue-200 px-3 py-1 text-gray-500">홍길동</td>
                    <td className="border border-blue-200 px-3 py-1 text-gray-500">자율활동 내용...</td>
                    <td className="border border-blue-200 px-3 py-1 text-gray-500">진로활동 내용...</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div className="mt-3 flex items-center justify-between">
              <p className="text-xs text-blue-600">⚠️ 동일 학급(학년+반) 데이터는 기존 내용을 덮어씁니다.</p>
              <button
                onClick={downloadTemplate}
                className="flex items-center gap-1.5 text-xs font-semibold text-blue-700 bg-blue-100 hover:bg-blue-200 border border-blue-200 px-3 py-1.5 rounded-lg transition-colors shrink-0"
              >
                📥 템플릿 다운로드
              </button>
            </div>
          </div>

          {/* 파일 드롭존 */}
          {!uploadResult && (
            <div
              className={`border-2 border-dashed rounded-xl p-8 flex flex-col items-center gap-3 cursor-pointer transition-colors ${
                isDragging ? "border-primary bg-primary-light" : "border-gray-300 hover:border-primary hover:bg-gray-50"
              }`}
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <span className="text-4xl">📄</span>
              <p className="font-semibold text-gray-600">파일을 드래그하거나 클릭해서 선택</p>
              <p className="text-sm text-gray-400">.xlsx, .xls, .csv 지원</p>
              {fileName && <p className="text-sm text-primary font-medium">선택된 파일: {fileName}</p>}
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                className="hidden"
                onChange={handleFileChange}
              />
            </div>
          )}

          {/* 에러 메시지 */}
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 text-sm whitespace-pre-line">
              ❌ {error}
            </div>
          )}

          {/* 업로드 성공 결과 */}
          {uploadResult && (
            <div className="bg-green-50 border border-green-200 text-green-700 rounded-xl p-4 text-sm flex flex-col gap-1">
              <p className="font-bold text-base">✅ 업로드 완료!</p>
              <p>• 추가된 활동 데이터: <strong>{uploadResult.addedRows}행</strong></p>
              <p>• 삭제된 기존 데이터: <strong>{uploadResult.deletedRows}행</strong></p>
              <p className="text-xs text-green-600 mt-1">데이터가 반영됐습니다. 잠시 후 화면이 새로고침됩니다.</p>
            </div>
          )}

          {/* 파싱된 데이터 미리보기 */}
          {parsedRows.length > 0 && !uploadResult && (
            <div className="flex flex-col gap-3">
              {/* 학급별 요약 */}
              <div className="flex flex-wrap gap-2">
                {Object.entries(classSummary).map(([cls, cnt]) => (
                  <span key={cls} className="text-xs bg-primary-light text-primary font-semibold px-3 py-1 rounded-full">
                    {cls} · {cnt}명
                  </span>
                ))}
                <span className="text-xs bg-gray-100 text-gray-600 font-semibold px-3 py-1 rounded-full">
                  총 {parsedRows.length}명
                </span>
              </div>

              {/* 미리보기 테이블 */}
              <div className="overflow-auto max-h-52 rounded-xl border border-gray-200">
                <table className="w-full text-xs border-collapse">
                  <thead className="sticky top-0 bg-gray-100">
                    <tr>
                      {REQUIRED_COLUMNS.map((col) => (
                        <th key={col} className="border border-gray-200 px-3 py-2 font-semibold text-gray-600 whitespace-nowrap">{col}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {parsedRows.slice(0, 50).map((row, i) => (
                      <tr key={i} className={i % 2 === 0 ? "bg-white" : "bg-gray-50"}>
                        <td className="border border-gray-200 px-3 py-1.5 text-center">{row.학년}</td>
                        <td className="border border-gray-200 px-3 py-1.5 text-center">{row.반}</td>
                        <td className="border border-gray-200 px-3 py-1.5 text-center">{row.번호}</td>
                        <td className="border border-gray-200 px-3 py-1.5 font-medium">{row.이름}</td>
                        <td className="border border-gray-200 px-3 py-1.5 text-blue-600 font-medium whitespace-nowrap">{row.자율활동명}</td>
                        <td className="border border-gray-200 px-3 py-1.5 max-w-[120px] truncate text-gray-500">{row.자율활동}</td>
                        <td className="border border-gray-200 px-3 py-1.5 text-blue-600 font-medium whitespace-nowrap">{row.진로활동명}</td>
                        <td className="border border-gray-200 px-3 py-1.5 max-w-[120px] truncate text-gray-500">{row.진로활동}</td>
                      </tr>
                    ))}
                    {parsedRows.length > 50 && (
                      <tr>
                        <td colSpan={6} className="text-center text-gray-400 py-2 text-xs">
                          ... 외 {parsedRows.length - 50}명 (미리보기는 50명까지 표시)
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-gray-200 bg-gray-50/80 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm font-semibold text-gray-600 bg-white border border-gray-200 hover:bg-gray-50 transition-colors"
          >
            {uploadResult ? "닫기" : "취소"}
          </button>
          {parsedRows.length > 0 && !uploadResult && (
            <button
              onClick={handleUpload}
              disabled={isUploading}
              className={`px-5 py-2 rounded-lg text-sm font-bold text-white transition-colors ${
                isUploading ? "bg-gray-400 cursor-not-allowed" : "bg-primary hover:bg-primary-hover"
              }`}
            >
              {isUploading ? "업로드 중..." : `📤 ${parsedRows.length}명 데이터 업로드`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
