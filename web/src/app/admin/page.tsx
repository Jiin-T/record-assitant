"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import * as XLSX from "xlsx";

// ─── Types ───────────────────────────────────────────────────────────────────

interface GradeConfig {
  grade: number;
  classes: number;
}

interface ClassConfig {
  grades: GradeConfig[];
}

interface SheetInfo {
  title: string;
  index: number;
  rowCount: number;
  columnCount: number;
}

interface SheetsInfo {
  connected: boolean;
  title?: string;
  sheetId?: string;
  email?: string;
  sheets?: SheetInfo[];
  error?: string;
}

interface UploadRow {
  학년: string;
  반: string;
  번호: string;
  이름: string;
  활동명: string;
  입력내용: string;
  입력영역: string;
}

type Tab = "config" | "sheets" | "history" | "upload";

const SHEET1_COLUMNS = ["학년", "반", "번호", "이름", "활동명", "입력내용", "입력영역"] as const;
const SHEET2_COLUMNS = ["활동명", "활동내용", "입력영역"] as const;

// ─── Admin Page ───────────────────────────────────────────────────────────────

export default function AdminPage() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  const [activeTab, setActiveTab] = useState<Tab>("config");

  // Check sessionStorage on mount
  useEffect(() => {
    const stored = sessionStorage.getItem("adminToken");
    if (stored) setIsLoggedIn(true);
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError("");
    setIsLoggingIn(true);
    try {
      const res = await fetch("/api/admin/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();
      if (res.ok) {
        sessionStorage.setItem("adminToken", password);
        setIsLoggedIn(true);
      } else {
        setLoginError(data.error || "로그인 실패");
      }
    } catch {
      setLoginError("서버 연결 실패");
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleLogout = () => {
    sessionStorage.removeItem("adminToken");
    setIsLoggedIn(false);
    setPassword("");
  };

  if (!isLoggedIn) {
    return <LoginScreen password={password} setPassword={setPassword} error={loginError} isLoading={isLoggingIn} onSubmit={handleLogin} />;
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 flex flex-col">
      {/* Header */}
      <header className="border-b border-gray-800 bg-gray-900/80 backdrop-blur px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center text-white font-bold text-sm">관</div>
          <div>
            <h1 className="text-base font-semibold text-white">관리자 페이지</h1>
            <p className="text-xs text-gray-400">생활기록부 생성 도우미</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <a href="/" className="text-sm text-gray-400 hover:text-white transition-colors">← 메인으로</a>
          <button
            onClick={handleLogout}
            className="text-sm bg-gray-800 hover:bg-gray-700 text-gray-300 px-3 py-1.5 rounded-lg transition-colors"
          >
            로그아웃
          </button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <nav className="w-52 border-r border-gray-800 bg-gray-900/50 flex flex-col py-4 px-3 gap-1 shrink-0">
          <TabButton active={activeTab === "upload"} onClick={() => setActiveTab("upload")} icon="⬆️" label="시트 데이터 업로드" />
          <TabButton active={activeTab === "config"} onClick={() => setActiveTab("config")} icon="🏫" label="학급 구성 설정" />
          <TabButton active={activeTab === "sheets"} onClick={() => setActiveTab("sheets")} icon="📊" label="Google Sheets 정보" />
          <TabButton active={activeTab === "history"} onClick={() => setActiveTab("history")} icon="📋" label="업로드 이력" />
        </nav>

        {/* Main Content */}
        <main className="flex-1 overflow-y-auto p-6">
          {activeTab === "upload" && <SheetUploadTab />}
          {activeTab === "config" && <ConfigTab />}
          {activeTab === "sheets" && <SheetsTab />}
          {activeTab === "history" && <HistoryTab />}
        </main>
      </div>
    </div>
  );
}

// ─── Login Screen ─────────────────────────────────────────────────────────────

function LoginScreen({
  password, setPassword, error, isLoading, onSubmit,
}: {
  password: string;
  setPassword: (v: string) => void;
  error: string;
  isLoading: boolean;
  onSubmit: (e: React.FormEvent) => void;
}) {
  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-indigo-600 flex items-center justify-center text-white font-bold text-2xl mx-auto mb-4">관</div>
          <h1 className="text-xl font-semibold text-white">관리자 로그인</h1>
          <p className="text-sm text-gray-400 mt-1">생활기록부 생성 도우미 관리자</p>
        </div>

        <form onSubmit={onSubmit} className="bg-gray-900 border border-gray-800 rounded-2xl p-6 flex flex-col gap-4">
          <div>
            <label className="text-sm font-medium text-gray-300 block mb-1.5">비밀번호</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="관리자 비밀번호 입력"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors"
              autoFocus
            />
          </div>

          {error && (
            <div className="bg-red-950/50 border border-red-800 rounded-lg px-3 py-2 text-sm text-red-300">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={isLoading || !password}
            className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-900 disabled:text-indigo-400 text-white font-medium py-2.5 rounded-lg transition-colors text-sm"
          >
            {isLoading ? "확인 중..." : "로그인"}
          </button>
        </form>

        <p className="text-xs text-gray-600 text-center mt-4">
          비밀번호는 .env.local의 ADMIN_PASSWORD 값입니다.
        </p>
      </div>
    </div>
  );
}

// ─── Tab Button ───────────────────────────────────────────────────────────────

function TabButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: string; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm text-left w-full transition-colors ${
        active ? "bg-indigo-600 text-white font-medium" : "text-gray-400 hover:text-white hover:bg-gray-800"
      }`}
    >
      <span className="text-base">{icon}</span>
      <span>{label}</span>
    </button>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getToken(): string {
  return sessionStorage.getItem("adminToken") || "";
}

function adminFetch(url: string, options: RequestInit = {}) {
  return fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getToken()}`,
      ...(options.headers || {}),
    },
  });
}

// ─── Config Tab ───────────────────────────────────────────────────────────────

function ConfigTab() {
  const [config, setConfig] = useState<ClassConfig>({ grades: [] });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    adminFetch("/api/admin/config")
      .then(r => r.json())
      .then(data => {
        if (data.config) {
          setConfig(data.config);
        } else {
          setConfig({ grades: [{ grade: 1, classes: 6 }] });
        }
      })
      .catch(() => setConfig({ grades: [{ grade: 1, classes: 6 }] }))
      .finally(() => setLoading(false));
  }, []);

  const addGrade = () => {
    const nextGrade = config.grades.length > 0 ? Math.max(...config.grades.map(g => g.grade)) + 1 : 1;
    setConfig(prev => ({ ...prev, grades: [...prev.grades, { grade: nextGrade, classes: 6 }] }));
  };

  const removeGrade = (idx: number) => {
    setConfig(prev => ({ ...prev, grades: prev.grades.filter((_, i) => i !== idx) }));
  };

  const updateClasses = (idx: number, classes: number) => {
    setConfig(prev => ({
      ...prev,
      grades: prev.grades.map((g, i) => i === idx ? { ...g, classes } : g),
    }));
  };

  const updateGrade = (idx: number, grade: number) => {
    setConfig(prev => ({
      ...prev,
      grades: prev.grades.map((g, i) => i === idx ? { ...g, grade } : g),
    }));
  };

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const res = await adminFetch("/api/admin/config", {
        method: "POST",
        body: JSON.stringify({ config }),
      });
      const data = await res.json();
      if (res.ok) {
        setMessage({ type: "success", text: "학급 구성이 저장되었습니다." });
      } else {
        setMessage({ type: "error", text: data.error || "저장 실패" });
      }
    } catch {
      setMessage({ type: "error", text: "서버 연결 실패" });
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <LoadingSpinner />;

  const totalStudents = config.grades.reduce((sum, g) => sum + g.classes, 0);

  return (
    <div className="max-w-2xl">
      <SectionHeader title="학급 구성 설정" description="학년별 반 수를 설정합니다. 설정값은 Google Sheets의 '설정' 시트에 저장됩니다." />

      <div className="space-y-3 mb-6">
        {config.grades.length === 0 && (
          <div className="text-center py-10 text-gray-500 border border-dashed border-gray-700 rounded-xl">
            학년을 추가해주세요.
          </div>
        )}

        {config.grades.map((g, idx) => (
          <div key={idx} className="bg-gray-900 border border-gray-800 rounded-xl px-5 py-4 flex items-center gap-4">
            <div className="flex items-center gap-2">
              <label className="text-sm text-gray-400 whitespace-nowrap">학년</label>
              <input
                type="number"
                min={1}
                max={6}
                value={g.grade}
                onChange={e => updateGrade(idx, parseInt(e.target.value) || 1)}
                className="w-16 bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white text-center focus:outline-none focus:border-indigo-500"
              />
            </div>

            <div className="flex items-center gap-2 flex-1">
              <label className="text-sm text-gray-400 whitespace-nowrap">반 수</label>
              <input
                type="range"
                min={1}
                max={20}
                value={g.classes}
                onChange={e => updateClasses(idx, parseInt(e.target.value))}
                className="flex-1 accent-indigo-500"
              />
              <span className="text-sm font-mono text-white w-12 text-right">{g.classes}반</span>
            </div>

            <button
              onClick={() => removeGrade(idx)}
              className="text-gray-600 hover:text-red-400 transition-colors text-lg leading-none"
              title="삭제"
            >
              ×
            </button>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={addGrade}
          className="flex items-center gap-2 bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm px-4 py-2 rounded-lg transition-colors border border-gray-700"
        >
          <span>＋</span> 학년 추가
        </button>
        {config.grades.length > 0 && (
          <span className="text-xs text-gray-500">
            총 {config.grades.length}개 학년, {totalStudents}개 반
          </span>
        )}
      </div>

      {message && (
        <div className={`mb-4 px-4 py-3 rounded-lg text-sm border ${
          message.type === "success"
            ? "bg-green-950/50 border-green-800 text-green-300"
            : "bg-red-950/50 border-red-800 text-red-300"
        }`}>
          {message.text}
        </div>
      )}

      <button
        onClick={handleSave}
        disabled={saving || config.grades.length === 0}
        className="bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-900 disabled:text-indigo-400 text-white font-medium px-6 py-2.5 rounded-lg transition-colors text-sm"
      >
        {saving ? "저장 중..." : "저장"}
      </button>
    </div>
  );
}

// ─── Sheets Tab ───────────────────────────────────────────────────────────────

function SheetsTab() {
  const [info, setInfo] = useState<SheetsInfo | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchInfo = useCallback(() => {
    setLoading(true);
    adminFetch("/api/admin/sheets-info")
      .then(r => r.json())
      .then(setInfo)
      .catch(() => setInfo({ connected: false, error: "서버 연결 실패" }))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { fetchInfo(); }, [fetchInfo]);

  if (loading) return <LoadingSpinner />;

  return (
    <div className="max-w-2xl">
      <SectionHeader title="Google Sheets 정보" description="현재 연결된 Google Spreadsheet 정보를 확인합니다." />

      {/* Connection Status */}
      <div className={`flex items-center gap-3 px-5 py-4 rounded-xl border mb-6 ${
        info?.connected
          ? "bg-green-950/30 border-green-800"
          : "bg-red-950/30 border-red-800"
      }`}>
        <div className={`w-2.5 h-2.5 rounded-full ${info?.connected ? "bg-green-400" : "bg-red-400"}`} />
        <span className={`text-sm font-medium ${info?.connected ? "text-green-300" : "text-red-300"}`}>
          {info?.connected ? "연결됨" : "연결 실패"}
        </span>
        {info?.error && <span className="text-xs text-red-400 ml-2">{info.error}</span>}
        <button
          onClick={fetchInfo}
          className="ml-auto text-xs text-gray-500 hover:text-white transition-colors"
        >
          새로고침
        </button>
      </div>

      {info?.connected && (
        <>
          {/* Spreadsheet Info */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden mb-6">
            <div className="px-5 py-3 border-b border-gray-800">
              <h3 className="text-sm font-medium text-gray-200">스프레드시트 정보</h3>
            </div>
            <div className="divide-y divide-gray-800">
              <InfoRow label="문서 제목" value={info.title || "-"} />
              <InfoRow label="Sheet ID" value={info.sheetId || "-"} mono />
              <InfoRow label="서비스 계정" value={info.email || "-"} mono />
            </div>
          </div>

          {/* Sheets List */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-800 flex items-center justify-between">
              <h3 className="text-sm font-medium text-gray-200">시트 목록</h3>
              <span className="text-xs text-gray-500">{info.sheets?.length ?? 0}개</span>
            </div>
            <div className="divide-y divide-gray-800">
              {info.sheets?.map(sheet => (
                <div key={sheet.index} className="px-5 py-3 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-600 font-mono w-5">{sheet.index}</span>
                    <span className="text-sm text-gray-200">{sheet.title}</span>
                    {sheet.title === '업로드데이터' && (
                      <span className="text-xs bg-blue-900/50 text-blue-300 border border-blue-800 px-1.5 py-0.5 rounded">업로드</span>
                    )}
                    {sheet.title === '설정' && (
                      <span className="text-xs bg-purple-900/50 text-purple-300 border border-purple-800 px-1.5 py-0.5 rounded">설정</span>
                    )}
                    {sheet.title === '자율/진로수정' && (
                      <span className="text-xs bg-amber-900/50 text-amber-300 border border-amber-800 px-1.5 py-0.5 rounded">원본수정</span>
                    )}
                    {sheet.title === '추가문구수정' && (
                      <span className="text-xs bg-teal-900/50 text-teal-300 border border-teal-800 px-1.5 py-0.5 rounded">문구수정</span>
                    )}
                    {sheet.index === 0 && (
                      <span className="text-xs bg-gray-800 text-gray-400 border border-gray-700 px-1.5 py-0.5 rounded">원본</span>
                    )}
                  </div>
                  <span className="text-xs text-gray-500">{sheet.rowCount}행 × {sheet.columnCount}열</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ─── History Tab ─────────────────────────────────────────────────────────────

function HistoryTab() {
  const [rows, setRows] = useState<UploadRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterGrade, setFilterGrade] = useState("");
  const [filterClass, setFilterClass] = useState("");
  const [filterArea, setFilterArea] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const fetchHistory = useCallback(() => {
    setLoading(true);
    adminFetch("/api/admin/upload-history")
      .then(r => r.json())
      .then(data => setRows(data.rows || []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { fetchHistory(); }, [fetchHistory]);

  const grades = Array.from(new Set(rows.map(r => r.학년).filter(Boolean))).sort();
  const classes = Array.from(new Set(rows.filter(r => !filterGrade || r.학년 === filterGrade).map(r => r.반).filter(Boolean))).sort((a, b) => parseInt(a) - parseInt(b));

  const filtered = rows.filter(r =>
    (!filterGrade || r.학년 === filterGrade) &&
    (!filterClass || r.반 === filterClass) &&
    (!filterArea || r.입력영역 === filterArea)
  );

  const handleDeleteAll = async () => {
    if (!confirm("업로드 이력 전체를 삭제하시겠습니까?")) return;
    setDeleting(true);
    setMessage(null);
    try {
      const res = await adminFetch("/api/admin/upload-history", { method: "DELETE" });
      const data = await res.json();
      if (res.ok) {
        setMessage({ type: "success", text: "업로드 이력이 전체 삭제되었습니다." });
        fetchHistory();
      } else {
        setMessage({ type: "error", text: data.error || "삭제 실패" });
      }
    } catch {
      setMessage({ type: "error", text: "서버 연결 실패" });
    } finally {
      setDeleting(false);
    }
  };

  const handleDeleteFiltered = async () => {
    if (!filterGrade) { alert("삭제할 학년을 선택해주세요."); return; }
    const label = filterClass ? `${filterGrade}학년 ${filterClass}반` : `${filterGrade}학년 전체`;
    if (!confirm(`${label}의 업로드 이력을 삭제하시겠습니까?`)) return;
    setDeleting(true);
    setMessage(null);
    try {
      const params = new URLSearchParams({ grade: filterGrade });
      if (filterClass) params.set("class", filterClass);
      const res = await adminFetch(`/api/admin/upload-history?${params}`, { method: "DELETE" });
      const data = await res.json();
      if (res.ok) {
        setMessage({ type: "success", text: `${label} 업로드 이력이 삭제되었습니다. (${data.deletedRows}건)` });
        fetchHistory();
      } else {
        setMessage({ type: "error", text: data.error || "삭제 실패" });
      }
    } catch {
      setMessage({ type: "error", text: "서버 연결 실패" });
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="max-w-5xl">
      <SectionHeader title="업로드 이력" description="'업로드데이터' 시트에 저장된 데이터를 확인하고 관리합니다." />

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <select
          value={filterGrade}
          onChange={e => { setFilterGrade(e.target.value); setFilterClass(""); }}
          className="bg-gray-800 border border-gray-700 text-sm text-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:border-indigo-500"
        >
          <option value="">전체 학년</option>
          {grades.map(g => <option key={g} value={g}>{g}학년</option>)}
        </select>

        <select
          value={filterClass}
          onChange={e => setFilterClass(e.target.value)}
          disabled={!filterGrade}
          className="bg-gray-800 border border-gray-700 text-sm text-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:border-indigo-500 disabled:opacity-40"
        >
          <option value="">전체 반</option>
          {classes.map(c => <option key={c} value={c}>{c}반</option>)}
        </select>

        <select
          value={filterArea}
          onChange={e => setFilterArea(e.target.value)}
          className="bg-gray-800 border border-gray-700 text-sm text-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:border-indigo-500"
        >
          <option value="">전체 영역</option>
          <option value="자율활동">자율활동</option>
          <option value="진로활동">진로활동</option>
        </select>

        <button onClick={fetchHistory} className="text-sm text-gray-400 hover:text-white transition-colors px-2 py-2">새로고침</button>

        <div className="ml-auto flex items-center gap-2">
          {filterGrade && (
            <button
              onClick={handleDeleteFiltered}
              disabled={deleting}
              className="text-sm bg-orange-900/40 hover:bg-orange-900/60 border border-orange-800 text-orange-300 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
            >
              선택 삭제
            </button>
          )}
          <button
            onClick={handleDeleteAll}
            disabled={deleting || rows.length === 0}
            className="text-sm bg-red-900/40 hover:bg-red-900/60 border border-red-800 text-red-300 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
          >
            전체 삭제
          </button>
        </div>
      </div>

      {message && (
        <div className={`mb-4 px-4 py-3 rounded-lg text-sm border ${
          message.type === "success"
            ? "bg-green-950/50 border-green-800 text-green-300"
            : "bg-red-950/50 border-red-800 text-red-300"
        }`}>
          {message.text}
        </div>
      )}

      {loading ? (
        <LoadingSpinner />
      ) : (
        <>
          <div className="text-xs text-gray-500 mb-3">총 {filtered.length}건 (전체 {rows.length}건)</div>
          <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
            {filtered.length === 0 ? (
              <div className="py-12 text-center text-gray-500 text-sm">데이터가 없습니다.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-800 bg-gray-800/50">
                      <Th>학년</Th>
                      <Th>반</Th>
                      <Th>번호</Th>
                      <Th>이름</Th>
                      <Th>활동명</Th>
                      <Th>영역</Th>
                      <Th wide>입력내용</Th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-800/60">
                    {filtered.map((row, idx) => (
                      <tr key={idx} className="hover:bg-gray-800/30 transition-colors">
                        <Td center>{row.학년}</Td>
                        <Td center>{row.반}</Td>
                        <Td center>{row.번호}</Td>
                        <Td>{row.이름}</Td>
                        <Td>{row.활동명 || "-"}</Td>
                        <Td>
                          <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                            row.입력영역 === "자율활동"
                              ? "bg-blue-900/50 text-blue-300"
                              : "bg-emerald-900/50 text-emerald-300"
                          }`}>{row.입력영역}</span>
                        </Td>
                        <Td wide>
                          <span className="line-clamp-2 text-xs text-gray-400">{row.입력내용}</span>
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ─── Sheet Upload Tab ────────────────────────────────────────────────────────

type UploadMode = "replace" | "append";

interface ParsedSheet1Row {
  학년: string; 반: string; 번호: string; 이름: string;
  활동명: string; 입력내용: string; 입력영역: string;
}
interface ParsedSheet2Row { 활동명: string; 활동내용: string; 입력영역: string; }

function SheetUploadTab() {
  const [activeSheet, setActiveSheet] = useState<"sheet1" | "sheet2">("sheet1");
  return (
    <div className="max-w-3xl">
      <SectionHeader
        title="시트 데이터 업로드"
        description="Google Spreadsheet의 원본 시트 데이터를 Excel/CSV 파일로 교체하거나 추가합니다."
      />
      <div className="flex gap-2 mb-6">
        <button
          onClick={() => setActiveSheet("sheet1")}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            activeSheet === "sheet1"
              ? "bg-indigo-600 text-white"
              : "bg-gray-800 text-gray-400 hover:text-white border border-gray-700"
          }`}
        >
          시트 1 · 원본 활동 데이터
        </button>
        <button
          onClick={() => setActiveSheet("sheet2")}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            activeSheet === "sheet2"
              ? "bg-indigo-600 text-white"
              : "bg-gray-800 text-gray-400 hover:text-white border border-gray-700"
          }`}
        >
          시트 2 · 추천 문구 데이터
        </button>
      </div>
      {activeSheet === "sheet1" ? <Sheet1Uploader /> : <Sheet2Uploader />}
    </div>
  );
}

function Sheet1Uploader() {
  const [rows, setRows] = useState<ParsedSheet1Row[]>([]);
  const [fileName, setFileName] = useState("");
  const [parseError, setParseError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [mode, setMode] = useState<UploadMode>("replace");
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<{ addedRows: number; mode: string } | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const downloadTemplate = () => {
    const wb = XLSX.utils.book_new();
    const sample = [
      { 학년: 1, 반: 1, 번호: 1, 이름: "홍길동", 활동명: "양성평등교육(2025.03.07.)", 입력내용: "양성평등의 중요성을 이해하고...", 입력영역: "자율활동" },
      { 학년: 1, 반: 1, 번호: 1, 이름: "홍길동", 활동명: "진로탐색(2025.04.01.)", 입력내용: "다양한 직업군을 탐색하며...", 입력영역: "진로활동" },
    ];
    const ws = XLSX.utils.json_to_sheet(sample, { header: [...SHEET1_COLUMNS] });
    ws["!cols"] = [{ wch: 6 }, { wch: 6 }, { wch: 6 }, { wch: 10 }, { wch: 24 }, { wch: 40 }, { wch: 10 }];
    XLSX.utils.book_append_sheet(wb, ws, "원본활동데이터");
    XLSX.writeFile(wb, "자율진로원본_템플릿.xlsx");
  };

  const parseFile = useCallback((file: File) => {
    setParseError(null); setRows([]); setResult(null); setUploadError(null);
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target?.result, { type: "binary" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const json: any[] = XLSX.utils.sheet_to_json(ws, { defval: "" });
        if (json.length === 0) { setParseError("파일에 데이터가 없습니다."); return; }
        const missing = [...SHEET1_COLUMNS].filter(c => !(c in json[0]));
        if (missing.length > 0) {
          setParseError(`필수 열이 없습니다: ${missing.join(", ")}\n필요한 열: ${SHEET1_COLUMNS.join(", ")}`);
          return;
        }
        const parsed: ParsedSheet1Row[] = json
          .map(r => ({
            학년: String(r["학년"] ?? ""), 반: String(r["반"] ?? ""), 번호: String(r["번호"] ?? ""),
            이름: String(r["이름"] ?? ""), 활동명: String(r["활동명"] ?? ""),
            입력내용: String(r["입력내용"] ?? ""), 입력영역: String(r["입력영역"] ?? ""),
          }))
          .filter(r => r.이름.trim() !== "");
        if (parsed.length === 0) { setParseError("유효한 데이터가 없습니다."); return; }
        setRows(parsed);
      } catch { setParseError("파일 파싱 중 오류가 발생했습니다."); }
    };
    reader.readAsBinaryString(file);
  }, []);

  const handleUpload = async () => {
    setUploading(true); setUploadError(null);
    try {
      const res = await adminFetch("/api/admin/sheet-upload", {
        method: "POST",
        body: JSON.stringify({ target: "sheet1", rows, mode }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setResult(data);
      setRows([]);
    } catch (e: any) { setUploadError(e.message); }
    finally { setUploading(false); }
  };

  const areaCount = rows.reduce<Record<string, number>>((acc, r) => {
    acc[r.입력영역] = (acc[r.입력영역] || 0) + 1; return acc;
  }, {});

  return (
    <SheetUploaderLayout
      sheetName="시트 1 (원본 활동 데이터)"
      columns={[...SHEET1_COLUMNS]}
      description="학년/반/번호/이름/활동명/입력내용/입력영역 형식의 원본 데이터입니다."
      mode={mode} setMode={setMode}
      fileName={fileName} isDragging={isDragging}
      parseError={parseError} uploadError={uploadError}
      onDownloadTemplate={downloadTemplate}
      onFileChange={e => { const f = e.target.files?.[0]; if (f) parseFile(f); }}
      onDrop={e => { e.preventDefault(); setIsDragging(false); const f = e.dataTransfer.files?.[0]; if (f) parseFile(f); }}
      onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
      onDragLeave={() => setIsDragging(false)}
      onClickZone={() => fileInputRef.current?.click()}
      fileInputRef={fileInputRef}
      rowCount={rows.length}
      result={result ? { addedRows: result.addedRows, mode: result.mode } : null}
      onUpload={handleUpload}
      uploading={uploading}
      onReset={() => { setRows([]); setFileName(""); setResult(null); setUploadError(null); }}
    >
      {rows.length > 0 && !result && (
        <>
          <div className="flex flex-wrap gap-2">
            {Object.entries(areaCount).map(([area, cnt]) => (
              <span key={area} className={`text-xs px-2.5 py-1 rounded-full font-medium ${area === "자율활동" ? "bg-blue-900/50 text-blue-300" : "bg-emerald-900/50 text-emerald-300"}`}>
                {area} {cnt}건
              </span>
            ))}
            <span className="text-xs px-2.5 py-1 rounded-full bg-gray-800 text-gray-300 font-medium">총 {rows.length}건</span>
          </div>
          <PreviewTable columns={[...SHEET1_COLUMNS]} rows={rows.slice(0, 30).map(r => [r.학년, r.반, r.번호, r.이름, r.활동명, r.입력내용.slice(0, 20) + (r.입력내용.length > 20 ? "…" : ""), r.입력영역])} total={rows.length} />
        </>
      )}
    </SheetUploaderLayout>
  );
}

function Sheet2Uploader() {
  const [rows, setRows] = useState<ParsedSheet2Row[]>([]);
  const [fileName, setFileName] = useState("");
  const [parseError, setParseError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [mode, setMode] = useState<UploadMode>("replace");
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<{ addedRows: number; mode: string; sheetTitle?: string } | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const downloadTemplate = () => {
    const wb = XLSX.utils.book_new();
    const sample = [
      { 활동명: "양성평등교육", 활동내용: "양성평등의 중요성을 깊이 이해하고 일상생활 속 성차별적 요소를 비판적으로 인식함.", 입력영역: "자율활동" },
      { 활동명: "양성평등교육", 활동내용: "성평등 의식을 함양하고 상호 존중의 자세로 학교생활에 임하는 태도를 보임.", 입력영역: "자율활동" },
      { 활동명: "진로탐색", 활동내용: "다양한 직업군에 대한 탐색을 통해 자신의 적성과 흥미를 파악함.", 입력영역: "진로활동" },
    ];
    const ws = XLSX.utils.json_to_sheet(sample, { header: [...SHEET2_COLUMNS] });
    ws["!cols"] = [{ wch: 20 }, { wch: 60 }, { wch: 10 }];
    XLSX.utils.book_append_sheet(wb, ws, "추가문구(자율)");
    XLSX.writeFile(wb, "추가문구자율_템플릿.xlsx");
  };

  const parseFile = useCallback((file: File) => {
    setParseError(null); setRows([]); setResult(null); setUploadError(null);
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target?.result, { type: "binary" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const json: any[] = XLSX.utils.sheet_to_json(ws, { defval: "" });
        if (json.length === 0) { setParseError("파일에 데이터가 없습니다."); return; }
        const missing = [...SHEET2_COLUMNS].filter(c => !(c in json[0]));
        if (missing.length > 0) {
          setParseError(`필수 열이 없습니다: ${missing.join(", ")}\n필요한 열: ${SHEET2_COLUMNS.join(", ")}`);
          return;
        }
        const parsed: ParsedSheet2Row[] = json
          .map(r => ({
            활동명: String(r["활동명"] ?? ""),
            활동내용: String(r["활동내용"] ?? ""),
            입력영역: String(r["입력영역"] ?? ""),
          }))
          .filter(r => r.활동명.trim() !== "");
        if (parsed.length === 0) { setParseError("유효한 데이터가 없습니다."); return; }
        setRows(parsed);
      } catch { setParseError("파일 파싱 중 오류가 발생했습니다."); }
    };
    reader.readAsBinaryString(file);
  }, []);

  const handleUpload = async () => {
    setUploading(true); setUploadError(null);
    try {
      const res = await adminFetch("/api/admin/sheet-upload", {
        method: "POST",
        body: JSON.stringify({ target: "sheet2", rows, mode }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setResult(data);
      setRows([]);
    } catch (e: any) { setUploadError(e.message); }
    finally { setUploading(false); }
  };

  const areaCount = rows.reduce<Record<string, number>>((acc, r) => {
    acc[r.입력영역] = (acc[r.입력영역] || 0) + 1; return acc;
  }, {});
  const actCount = new Set(rows.map(r => r.활동명)).size;

  return (
    <SheetUploaderLayout
      sheetName="시트 2 (추천 문구 데이터)"
      columns={[...SHEET2_COLUMNS]}
      description="활동명/활동내용/입력영역 형식의 추천 문구 데이터입니다. 같은 활동명으로 여러 변형 문구를 추가할 수 있습니다."
      mode={mode} setMode={setMode}
      fileName={fileName} isDragging={isDragging}
      parseError={parseError} uploadError={uploadError}
      onDownloadTemplate={downloadTemplate}
      onFileChange={e => { const f = e.target.files?.[0]; if (f) parseFile(f); }}
      onDrop={e => { e.preventDefault(); setIsDragging(false); const f = e.dataTransfer.files?.[0]; if (f) parseFile(f); }}
      onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
      onDragLeave={() => setIsDragging(false)}
      onClickZone={() => fileInputRef.current?.click()}
      fileInputRef={fileInputRef}
      rowCount={rows.length}
      result={result ? { addedRows: result.addedRows, mode: result.mode, extra: result.sheetTitle ? `시트명: ${result.sheetTitle}` : undefined } : null}
      onUpload={handleUpload}
      uploading={uploading}
      onReset={() => { setRows([]); setFileName(""); setResult(null); setUploadError(null); }}
    >
      {rows.length > 0 && !result && (
        <>
          <div className="flex flex-wrap gap-2">
            {Object.entries(areaCount).map(([area, cnt]) => (
              <span key={area} className={`text-xs px-2.5 py-1 rounded-full font-medium ${area === "자율활동" ? "bg-blue-900/50 text-blue-300" : area === "진로활동" ? "bg-emerald-900/50 text-emerald-300" : "bg-gray-700 text-gray-300"}`}>
                {area || "영역없음"} {cnt}건
              </span>
            ))}
            <span className="text-xs px-2.5 py-1 rounded-full bg-gray-800 text-gray-300 font-medium">활동 {actCount}종 / 총 {rows.length}건</span>
          </div>
          <PreviewTable columns={[...SHEET2_COLUMNS]} rows={rows.slice(0, 30).map(r => [r.활동명, r.활동내용.slice(0, 40) + (r.활동내용.length > 40 ? "…" : ""), r.입력영역])} total={rows.length} />
        </>
      )}
    </SheetUploaderLayout>
  );
}

// ─── Shared Uploader Layout ───────────────────────────────────────────────────

interface SheetUploaderLayoutProps {
  sheetName: string;
  columns: string[];
  description: string;
  mode: UploadMode;
  setMode: (m: UploadMode) => void;
  fileName: string;
  isDragging: boolean;
  parseError: string | null;
  uploadError: string | null;
  onDownloadTemplate: () => void;
  onFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onDrop: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: () => void;
  onClickZone: () => void;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  rowCount: number;
  result: { addedRows: number; mode: string; extra?: string } | null;
  onUpload: () => void;
  uploading: boolean;
  onReset: () => void;
  children?: React.ReactNode;
}

function SheetUploaderLayout({
  sheetName, columns, description, mode, setMode,
  fileName, isDragging, parseError, uploadError, onDownloadTemplate,
  onFileChange, onDrop, onDragOver, onDragLeave, onClickZone, fileInputRef,
  rowCount, result, onUpload, uploading, onReset, children,
}: SheetUploaderLayoutProps) {
  return (
    <div className="flex flex-col gap-5">
      {/* Header Info */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
        <div className="flex items-start justify-between gap-4 mb-3">
          <div>
            <h3 className="text-sm font-semibold text-white">{sheetName}</h3>
            <p className="text-xs text-gray-400 mt-1">{description}</p>
          </div>
          <button
            onClick={onDownloadTemplate}
            className="shrink-0 flex items-center gap-1.5 text-xs font-medium text-indigo-300 bg-indigo-900/40 hover:bg-indigo-900/60 border border-indigo-800 px-3 py-1.5 rounded-lg transition-colors"
          >
            📥 템플릿 다운로드
          </button>
        </div>
        {/* Column badges */}
        <div className="flex flex-wrap gap-1.5">
          {columns.map(c => (
            <span key={c} className="text-xs bg-gray-800 text-gray-300 border border-gray-700 px-2 py-0.5 rounded font-mono">{c}</span>
          ))}
        </div>
      </div>

      {/* Mode Select */}
      <div className="flex items-center gap-3">
        <span className="text-sm text-gray-400 shrink-0">업로드 방식</span>
        <label className={`flex items-center gap-2 cursor-pointer px-3 py-2 rounded-lg border text-sm transition-colors ${mode === "replace" ? "bg-orange-900/30 border-orange-700 text-orange-300" : "border-gray-700 text-gray-400 hover:border-gray-600"}`}>
          <input type="radio" name={`mode-${sheetName}`} value="replace" checked={mode === "replace"} onChange={() => setMode("replace")} className="accent-orange-500" />
          전체 교체 (기존 데이터 삭제 후 덮어쓰기)
        </label>
        <label className={`flex items-center gap-2 cursor-pointer px-3 py-2 rounded-lg border text-sm transition-colors ${mode === "append" ? "bg-blue-900/30 border-blue-700 text-blue-300" : "border-gray-700 text-gray-400 hover:border-gray-600"}`}>
          <input type="radio" name={`mode-${sheetName}`} value="append" checked={mode === "append"} onChange={() => setMode("append")} className="accent-blue-500" />
          추가 (기존 데이터 유지 후 이어붙이기)
        </label>
      </div>

      {/* Drop Zone */}
      {!result && (
        <div
          className={`border-2 border-dashed rounded-xl p-8 flex flex-col items-center gap-3 cursor-pointer transition-colors ${
            isDragging ? "border-indigo-500 bg-indigo-950/30" : "border-gray-700 hover:border-indigo-600 hover:bg-gray-900/50"
          }`}
          onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop} onClick={onClickZone}
        >
          <span className="text-4xl">📄</span>
          <p className="text-sm font-medium text-gray-300">파일을 드래그하거나 클릭해서 선택</p>
          <p className="text-xs text-gray-500">.xlsx, .xls, .csv 지원</p>
          {fileName && <p className="text-xs text-indigo-400 font-medium">{fileName}</p>}
          <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={onFileChange} />
        </div>
      )}

      {/* Parse/Upload Error */}
      {(parseError || uploadError) && (
        <div className="bg-red-950/50 border border-red-800 rounded-xl px-4 py-3 text-sm text-red-300 whitespace-pre-line">
          ❌ {parseError || uploadError}
        </div>
      )}

      {/* Success Result */}
      {result && (
        <div className="bg-green-950/40 border border-green-800 rounded-xl px-5 py-4">
          <p className="text-green-300 font-semibold mb-1">✅ 업로드 완료</p>
          <p className="text-sm text-green-400">{result.addedRows}건 {result.mode === "replace" ? "전체 교체" : "추가"} 완료</p>
          {result.extra && <p className="text-xs text-green-500 mt-0.5">{result.extra}</p>}
          <button onClick={onReset} className="mt-3 text-xs text-gray-400 hover:text-white transition-colors">다시 업로드</button>
        </div>
      )}

      {/* Preview & Summary */}
      {children}

      {/* Upload Button */}
      {rowCount > 0 && !result && (
        <div className="flex items-center gap-3">
          {mode === "replace" && (
            <p className="text-xs text-orange-400">⚠️ 전체 교체 모드: 기존 시트 데이터가 모두 삭제됩니다.</p>
          )}
          <button
            onClick={onUpload}
            disabled={uploading}
            className="ml-auto shrink-0 bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-900 disabled:text-indigo-400 text-white font-medium px-6 py-2.5 rounded-lg transition-colors text-sm"
          >
            {uploading ? "업로드 중..." : `⬆️ ${rowCount}건 업로드`}
          </button>
        </div>
      )}
    </div>
  );
}

function PreviewTable({ columns, rows, total }: { columns: string[]; rows: string[][]; total: number }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
      <div className="px-4 py-2.5 border-b border-gray-800 flex items-center justify-between">
        <span className="text-xs font-medium text-gray-400">미리보기</span>
        {total > 30 && <span className="text-xs text-gray-500">처음 30건 표시 (전체 {total}건)</span>}
      </div>
      <div className="overflow-x-auto max-h-64">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-gray-800">
            <tr>
              {columns.map(c => <th key={c} className="px-3 py-2 text-left font-medium text-gray-300 whitespace-nowrap">{c}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800/60">
            {rows.map((row, i) => (
              <tr key={i} className="hover:bg-gray-800/40">
                {row.map((cell, j) => <td key={j} className="px-3 py-2 text-gray-400 whitespace-nowrap max-w-xs truncate">{cell}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Small Components ─────────────────────────────────────────────────────────

function SectionHeader({ title, description }: { title: string; description: string }) {
  return (
    <div className="mb-6">
      <h2 className="text-lg font-semibold text-white">{title}</h2>
      <p className="text-sm text-gray-400 mt-1">{description}</p>
    </div>
  );
}

function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="px-5 py-3 flex items-center justify-between gap-4">
      <span className="text-sm text-gray-400 shrink-0">{label}</span>
      <span className={`text-sm text-gray-200 truncate ${mono ? "font-mono" : ""}`}>{value}</span>
    </div>
  );
}

function Th({ children, wide }: { children: React.ReactNode; wide?: boolean }) {
  return (
    <th className={`text-left text-xs font-medium text-gray-400 px-4 py-3 ${wide ? "min-w-48" : ""}`}>
      {children}
    </th>
  );
}

function Td({ children, center, wide }: { children: React.ReactNode; center?: boolean; wide?: boolean }) {
  return (
    <td className={`px-4 py-3 text-gray-300 ${center ? "text-center" : ""} ${wide ? "max-w-xs" : ""}`}>
      {children}
    </td>
  );
}

function LoadingSpinner() {
  return (
    <div className="flex items-center justify-center py-16">
      <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );
}
