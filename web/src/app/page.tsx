"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LandingPage() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);

    try {
      const res = await fetch("/api/auth/class", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: code.trim() }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "코드 확인 중 오류가 발생했습니다.");
        return;
      }

      const { grade, classNum } = data;
      // 인증 정보를 sessionStorage에 저장 (탭을 닫으면 만료)
      sessionStorage.setItem(
        `classAuth_${grade}_${classNum}`,
        JSON.stringify({ grade, classNum, code: code.trim(), authedAt: Date.now() })
      );

      router.push(`/${grade}/${classNum}`);
    } catch {
      setError("서버 연결에 실패했습니다. 잠시 후 다시 시도해주세요.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Logo / Title */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-white/10 backdrop-blur border border-white/20 mb-5 shadow-lg">
            <span className="text-3xl">📝</span>
          </div>
          <h1 className="text-2xl font-bold text-white tracking-tight">생활기록부 도우미</h1>
          <p className="text-sm text-white/50 mt-2">담임 코드를 입력하면 해당 학급 페이지로 이동합니다.</p>
        </div>

        {/* Code Input Card */}
        <form
          onSubmit={handleSubmit}
          className="glass-panel rounded-2xl p-7 flex flex-col gap-4"
        >
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              담임 코드
            </label>
            <input
              type="text"
              value={code}
              onChange={e => setCode(e.target.value)}
              placeholder="코드를 입력하세요"
              className="w-full border border-gray-200 rounded-xl px-4 py-3 text-base text-gray-800 placeholder-gray-300 focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-transparent transition-all bg-white/80 tracking-widest text-center font-mono"
              autoFocus
              autoComplete="off"
            />
          </div>

          {error && (
            <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-600 rounded-xl px-4 py-3 text-sm">
              <span>⚠️</span>
              <span>{error}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={isLoading || code.trim() === ""}
            className="w-full bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 disabled:bg-gray-300 disabled:text-gray-400 text-white font-semibold py-3 rounded-xl transition-all text-sm shadow-md disabled:shadow-none"
          >
            {isLoading ? (
              <span className="flex items-center justify-center gap-2">
                <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                확인 중...
              </span>
            ) : (
              "입장하기"
            )}
          </button>
        </form>

        <p className="text-center text-xs text-white/30 mt-6">
          코드는 담당 관리자에게 문의해주세요.
        </p>
      </div>
    </div>
  );
}
