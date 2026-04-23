"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { DragDropContext, Droppable, Draggable } from "@hello-pangea/dnd";
import * as Diff from "diff";
import UploadModal from "../../components/UploadModal";

// Byte calculation utility
// 영어·숫자·특수문자·띄어쓰기: 1B / 엔터: 2B / 한글: 3B
function getByteLength(str: string) {
  let byteLength = 0;
  for (let i = 0; i < (str || "").length; i++) {
    const code = str.charCodeAt(i);
    if (code === 0x000A) {
      byteLength += 2; // 엔터(개행)
    } else if (
      (code >= 0xAC00 && code <= 0xD7A3) || // 한글 음절
      (code >= 0x1100 && code <= 0x11FF) ||  // 한글 자모
      (code >= 0x3130 && code <= 0x318F) ||  // 한글 호환 자모
      (code >= 0xA960 && code <= 0xA97F) ||  // 한글 자모 확장-A
      (code >= 0xD7B0 && code <= 0xD7FF)     // 한글 자모 확장-B
    ) {
      byteLength += 3; // 한글
    } else {
      byteLength += 1; // 영어, 숫자, 특수문자, 띄어쓰기
    }
  }
  return byteLength;
}

// AI diff를 "변경 그룹" 단위로 묶기 (연속된 removed/added를 하나의 그룹으로)
interface ChangeGroup {
  type: 'unchanged' | 'change';
  text?: string;      // unchanged
  original: string;   // change: 원본 텍스트
  ai: string;         // change: AI 버전 텍스트
  index: number;      // change group 번호 (-1 = unchanged)
}

function buildChangeGroups(diff: Diff.Change[]): ChangeGroup[] {
  const groups: ChangeGroup[] = [];
  let changeIndex = 0;
  let i = 0;
  while (i < diff.length) {
    const part = diff[i];
    if (!part.added && !part.removed) {
      groups.push({ type: 'unchanged', text: part.value, original: part.value, ai: part.value, index: -1 });
      i++;
    } else {
      let originalText = '';
      let aiText = '';
      while (i < diff.length && (diff[i].added || diff[i].removed)) {
        if (diff[i].removed) originalText += diff[i].value;
        if (diff[i].added) aiText += diff[i].value;
        i++;
      }
      groups.push({ type: 'change', original: originalText, ai: aiText, index: changeIndex++ });
    }
  }
  return groups;
}

// 활동명에서 날짜 추출 (예: "양성평등교육(2025.03.07.)" → Date)
function extractDateFromName(name: string): Date | null {
  const match = (name || "").match(/\((\d{4})[./\-](\d{1,2})[./\-](\d{1,2})/);
  if (match) return new Date(parseInt(match[1]), parseInt(match[2]) - 1, parseInt(match[3]));
  return null;
}

// 새 활동들을 날짜 순서에 맞는 위치에 삽입 (기존 항목 순서는 유지)
function insertActivitiesByDate(allActivities: any[], newActivities: any[], studentKey: string, tab: string): any[] {
  // 새 항목끼리도 날짜순 정렬 후 순서대로 삽입
  const sortedNew = [...newActivities].sort((a, b) => {
    const da = extractDateFromName(a['활동명']);
    const db = extractDateFromName(b['활동명']);
    if (da && db) return da.getTime() - db.getTime();
    if (da) return -1;
    if (db) return 1;
    return 0;
  });

  let result = [...allActivities];

  for (const newAct of sortedNew) {
    const newDate = extractDateFromName(newAct['활동명']);
    const studentTabItems = result
      .map((a, i) => ({ a, i }))
      .filter(({ a }) =>
        `${a['학년']}-${a['반']}-${a['번호']}-${a['이름']}` === studentKey &&
        a['입력영역'] === tab && !a.isDeleted
      );

    if (studentTabItems.length === 0) {
      result.push(newAct);
      continue;
    }

    let insertGlobalIndex: number;
    if (!newDate) {
      // 날짜 없으면 기존 항목 맨 뒤
      insertGlobalIndex = studentTabItems[studentTabItems.length - 1].i + 1;
    } else {
      // 날짜가 더 큰 첫 번째 항목 앞에 삽입
      const laterItem = studentTabItems.find(({ a }) => {
        const d = extractDateFromName(a['활동명']);
        return d && d > newDate;
      });
      insertGlobalIndex = laterItem ? laterItem.i : studentTabItems[studentTabItems.length - 1].i + 1;
    }

    result.splice(insertGlobalIndex, 0, newAct);
  }

  return result;
}

export default function ClassPage() {
  const params = useParams<{ grade: string; classNum: string }>();
  const router = useRouter();
  const grade = params.grade;
  const classNum = params.classNum;

  const [activeTab, setActiveTab] = useState<"자율활동" | "진로활동">("자율활동");
  const [activeStudentId, setActiveStudentId] = useState<string | null>(null);
  
  // Sidebar Collapsible State
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [recFilter, setRecFilter] = useState<"전체" | "추천">("추천");
  const [expandedRecs, setExpandedRecs] = useState<Record<string, number | null>>({});
  
  const toggleRec = (title: string, idx: number = 0) => {
    setExpandedRecs(prev => ({ 
      ...prev, 
      [title]: prev[title] === idx ? null : idx 
    }));
  };

  const [expandedActs, setExpandedActs] = useState<Record<number, boolean>>({});
  const toggleAct = (localId: number) => {
    setExpandedActs(prev => ({ ...prev, [localId]: !prev[localId] }));
  };

  const [showRecommendations, setShowRecommendations] = useState(false);

  // Activity-level AI shortening states
  const [selectedForShortening, setSelectedForShortening] = useState<Set<number>>(new Set());
  const [activityAiStates, setActivityAiStates] = useState<Record<number, { aiContent: string; selectedVersions: Record<number, 'ai' | 'original'> }>>({});
  const [shorteningActivityIds, setShorteningActivityIds] = useState<Set<number>>(new Set());
  
  const toggleGroup = (groupKey: string) => {
    setExpandedGroups(prev => ({ ...prev, [groupKey]: !prev[groupKey] }));
  };
  // Data States
  const [students, setStudents] = useState<any[]>([]);
  const [activities, setActivities] = useState<any[]>([]);
  const [originalActivities, setOriginalActivities] = useState<any[]>([]);
  const [recommendations, setRecommendations] = useState<any[]>([]);
  
  // Modal States
  const [showOrderModal, setShowOrderModal] = useState(false);
  const [classAutoActs, setClassAutoActs] = useState<string[]>([]);
  const [classCareerActs, setClassCareerActs] = useState<string[]>([]);
  const [globalOrders, setGlobalOrders] = useState<Record<string, { auto: string[], career: string[] }>>({});
  const [isShortening, setIsShortening] = useState(false);
  const [aiBaseText, setAiBaseText] = useState<string | null>(null);
  const [restoredChunks, setRestoredChunks] = useState<Set<number>>(new Set());
  const [finalText, setFinalText] = useState<string | null>(null);
  const [savedRecentContent, setSavedRecentContent] = useState<Record<number, string>>({});
  // 학생별 시트 저장시간 (학년-반-번호-이름 → 저장시간)
  const [sheetSavedAtMap, setSheetSavedAtMap] = useState<Record<string, string>>({});
  // 활동별 수정 상태 (localId → 수정 여부)
  const [activityModifiedMap, setActivityModifiedMap] = useState<Record<number, boolean>>({});

  // Loading & Error States
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);

  // Fetch Data from Google Sheets API
  const fetchData = async (forceRefresh = false) => {
    setLoading(true);
    try {
      const url = forceRefresh ? "/api/sheets?refresh=1" : "/api/sheets";
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 20000);
      let res: Response;
      try {
        res = await fetch(url, { cache: "no-store", signal: controller.signal });
      } catch (fetchErr: any) {
        if (fetchErr.name === "AbortError") {
          throw new Error("Google Sheets 연결 시간이 초과되었습니다. 네트워크 연결 및 스프레드시트 공유 설정을 확인해주세요.");
        }
        throw fetchErr;
      } finally {
        clearTimeout(timeoutId);
      }
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "데이터를 불러오는 중 오류가 발생했습니다.");
      }

      const allActivities = data.activities || [];
      const fetchedRecommendations = data.recommendations || [];

      // 현재 학급(grade/classNum)에 해당하는 활동만 필터링
      const fetchedActivities = allActivities.filter(
        (act: any) => String(act['학년']) === grade && String(act['반']) === classNum
      );

      const studentMap = new Map();
      fetchedActivities.forEach((act: any) => {
        const studentKey = `${act['학년']}-${act['반']}-${act['번호']}-${act['이름']}`;
        if (!studentMap.has(studentKey)) {
          studentMap.set(studentKey, {
            id: studentKey,
            grade: act['학년'],
            class: act['반'],
            num: act['번호'],
            name: act['이름'],
          });
        }
      });

      const studentList = Array.from(studentMap.values());
      studentList.sort((a: any, b: any) => {
        if (a.grade !== b.grade) return parseInt(a.grade) - parseInt(b.grade);
        if (a.class !== b.class) return parseInt(a.class) - parseInt(b.class);
        return parseInt(a.num) - parseInt(b.num);
      });

      setStudents(studentList);

      const activitiesWithId = fetchedActivities.map((act: any, idx: number) => ({
        ...act,
        _localId: idx
      }));

      setOriginalActivities(activitiesWithId);

      // 학급 시트에서 저장시간 데이터 가져오기
      const classData = await fetchClassData();
      const savedAtData: Record<string, string> = {};
      classData.forEach((row: any) => {
        if (row['저장시간']) {
          const key = `${row['학년']}-${row['반']}-${row['번호']}-${row['이름']}`;
          savedAtData[key] = row['저장시간'];
        }
      });
      setSheetSavedAtMap(savedAtData);

      // 활동별 수정 상태 확인 (일괄 처리로 할당량 최적화)
      const modifiedMap: Record<number, boolean> = {};
      try {
        const res = await fetch('/api/sheets/check-modified-batch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            grade: grade,
            classNum: classNum
          })
        });

        const result = await res.json();
        const modifiedActivities = result.modifiedActivities || [];
        
        activitiesWithId.forEach((activity: any) => {
          const key = `${activity['번호']}-${activity['이름']}-${activity['활동명']}-${activity['입력영역']}`;
          modifiedMap[activity._localId] = modifiedActivities.includes(key);
        });
      } catch (error) {
        console.error('수정 상태 확인 중 오류:', error);
        activitiesWithId.forEach((activity: any) => {
          modifiedMap[activity._localId] = false;
        });
      }
      setActivityModifiedMap(modifiedMap);

      // 활동 단위 안정 키: 학년/반/번호/이름/입력영역/활동명 조합
      const actStableKey = (a: any) =>
        `${a['학년']}||${a['반']}||${a['번호']}||${a['이름']}||${a['입력영역']}||${a['활동명'] ?? ''}`;

      const localData = localStorage.getItem(`recordAssistant_activities_${grade}_${classNum}`);
      let mergedActivities = [...activitiesWithId];

      if (localData) {
        try {
          const parsed = JSON.parse(localData);
          if (parsed && Array.isArray(parsed) && parsed.length > 0) {
            const serverKeys = new Set(activitiesWithId.map(actStableKey));

            // 동일 활동 키가 서버에도 있으면 서버 값을 우선한다.
            // 저장 완료 후 재조회한 수정 내용이 오래된 localStorage에 가려지지 않게 한다.
            mergedActivities = activitiesWithId.map((serverAct: any) => {
              return serverAct;
            });

            // localStorage에만 있는 활동 (사용자가 직접 추가한 것) 유지
            const userAdded = parsed.filter((a: any) => !serverKeys.has(actStableKey(a)));
            mergedActivities = [...mergedActivities, ...userAdded];
          }
        } catch {
          // ignore parse errors
        }
      }

      setActivities(mergedActivities);
      setRecommendations(fetchedRecommendations);

      if (studentList.length > 0) {
        setActiveStudentId(studentList[0].id);
        setAiBaseText(null);
        setRestoredChunks(new Set());
        setFinalText(null);
        const firstGroupKey = `${studentList[0].grade}학년 ${studentList[0].class}반`;
        setExpandedGroups({ [firstGroupKey]: true });
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // 인증 체크: sessionStorage에 해당 학급 인증 정보 없으면 메인으로 리다이렉트
  useEffect(() => {
    const auth = sessionStorage.getItem(`classAuth_${grade}_${classNum}`);
    if (!auth) {
      router.replace('/');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grade, classNum]);

  useEffect(() => {
    fetchData();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-save to localStorage (학급별 키 분리)
  const localStorageKey = `recordAssistant_activities_${grade}_${classNum}`;
  useEffect(() => {
    if (activities.length > 0) {
      localStorage.setItem(localStorageKey, JSON.stringify(activities));
    }
  }, [activities, localStorageKey]);

  useEffect(() => {
    const savedOrders = localStorage.getItem(`recordAssistant_globalOrders_${grade}_${classNum}`);
    if (savedOrders) {
      try {
        setGlobalOrders(JSON.parse(savedOrders));
      } catch (e) {}
    }
  }, []);

  useEffect(() => {
    if (Object.keys(globalOrders).length > 0) {
      localStorage.setItem(`recordAssistant_globalOrders_${grade}_${classNum}`, JSON.stringify(globalOrders));
    }
  }, [globalOrders]);

  
  
  // Filter activities based on selected student and active tab
  const currentStudentActivities = activities.filter((act) => {
    const studentKey = `${act['학년']}-${act['반']}-${act['번호']}-${act['이름']}`;
    return studentKey === activeStudentId && act['입력영역'] === activeTab;
  }).sort((a, b) => {
    if (a.isDeleted && !b.isDeleted) return 1;
    if (!a.isDeleted && b.isDeleted) return -1;
    return 0;
  });

  // Filter out deleted activities for stat calculations
  const activeStudentActivities = currentStudentActivities.filter(a => !a.isDeleted);

  // Compute stats
  const targetBytes = 1500;

  const combinedText = activeStudentActivities.map((act) => act['입력내용']).filter(Boolean).join(" ");
  // 최종 반영된 텍스트가 있으면 그것을 우선 사용 (복사·바이트 계산 기준)
  const displayText = finalText ?? combinedText;
  const totalBytes = getByteLength(displayText);
  const remainingBytes = Math.max(0, targetBytes - totalBytes);
  const progressPercent = Math.min(100, (totalBytes / targetBytes) * 100);
  const isOverLimit = totalBytes > targetBytes;

  // AI 비교 diff (aiBaseText가 있을 때만 계산)
  const aiDiff = aiBaseText ? Diff.diffChars(combinedText, aiBaseText) : null;

  // 복원된 청크를 반영한 최종 AI 표시 텍스트
  const aiDisplayText = aiDiff
    ? aiDiff.reduce((acc: string, part: Diff.Change, i: number) => {
        if (part.removed) return restoredChunks.has(i) ? acc + part.value : acc;
        return acc + part.value;
      }, '')
    : null;

  const toggleChunkRestore = (chunkIndex: number) => {
    setRestoredChunks(prev => {
      const next = new Set(prev);
      if (next.has(chunkIndex)) next.delete(chunkIndex);
      else next.add(chunkIndex);
      return next;
    });
  };

  // Handle Input Changes
  const handleContentChange = (localId: number, newContent: string) => {
    setActivities((prev) => prev.map((act) => (act._localId === localId ? { ...act, '입력내용': newContent } : act)));
  };

  // 활동이 수정되었는지 확인 (서버 저장 기록 기준)
  const isActivityModified = (activity: any) => {
    return activityModifiedMap[activity._localId] || false;
  };

  // 개별 활동 원본 복원
  const handleRestoreActivity = async (activity: any) => {
    if (!activity) return;
    
    const confirmMessage = `${activity['활동명']} 활동의 수정된 내용을 삭제하고 원본으로 되돌리시겠습니까?\n\n저장된 수정 기록이 삭제됩니다.`;
    if (!window.confirm(confirmMessage)) return;

    try {
      const res = await fetch('/api/sheets/restore-activity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grade: activity['학년'],
          classNum: activity['반'],
          studentNum: activity['번호'],
          studentName: activity['이름'],
          activityName: activity['활동명'],
          inputArea: activity['입력영역']
        })
      });

      const result = await res.json();
      if (!res.ok) {
        throw new Error(result.error || '복원 중 오류가 발생했습니다.');
      }

      // 원본 내용 찾기 (추가문구 활동 고려)
      let original = originalActivities.find(orig => {
        const origKey = `${orig['학년']}-${orig['반']}-${orig['번호']}-${orig['이름']}-${orig['활동명']}-${orig['입력영역']}`;
        const actKey = `${activity['학년']}-${activity['반']}-${activity['번호']}-${activity['이름']}-${activity['활동명']}-${activity['입력영역']}`;
        return origKey === actKey;
      });

      // 추가문구 활동인 경우 추가문구(자율) 시트에서 원본 찾기
      if (!original && activity._fromRecommendation) {
        try {
          const res = await fetch('/api/sheets/get-recommendation-original', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              grade: activity['학년'],
              classNum: activity['반'],
              studentNum: activity['번호'],
              studentName: activity['이름'],
              activityName: activity['활동명'],
              inputArea: activity['입력영역']
            })
          });

          const result = await res.json();
          if (result.success && result.original) {
            original = result.original;
            console.log('추가문구 원본 찾음:', original);
          }
        } catch (error) {
          console.error('추가문구 원본 조회 중 오류:', error);
        }
      }

      if (original) {
        const originalContent = original['입력내용'] || original['활동내용'] || '';
        console.log('원본 내용:', originalContent);
        console.log('현재 내용:', activity['입력내용']);
        
        handleContentChange(activity._localId, originalContent);
        // 수정 상태 업데이트
        setActivityModifiedMap(prev => ({ ...prev, [activity._localId]: false }));
        alert(`${activity['활동명']} 활동이 원본으로 복원되었습니다.`);
      } else {
        console.log('원본 데이터를 찾을 수 없음:', activity);
        console.log('사용 가능한 원본 데이터:', originalActivities.slice(0, 3));
        alert('원본 데이터를 찾을 수 없습니다.');
      }
      
    } catch (error: any) {
      alert('복원 중 오류가 발생했습니다: ' + error.message);
    }
  };

  const handleDeleteActivity = (localId: number) => {
    const target = activities.find(a => a._localId === localId);
    if (target?._fromRecommendation) {
      setActivities(prev => prev.filter(a => a._localId !== localId));
    } else {
      setActivities(prev => prev.map(a => a._localId === localId ? { ...a, isDeleted: true } : a));
    }
  };

  const handleRestoreDeletedActivity = (localId: number) => {
    setActivities(prev => {
      const newActivities = [...prev];
      const actIndex = newActivities.findIndex(a => a._localId === localId);
      if (actIndex === -1) return prev;
      
      const actToRestore = { ...newActivities[actIndex], isDeleted: false };
      newActivities.splice(actIndex, 1);
      
      let insertGlobalIndex = -1;
      
      if (activeStudent) {
         const classKey = `${activeStudent.grade}-${activeStudent.class}`;
         const savedOrder = globalOrders[classKey]?.[activeTab === '자율활동' ? 'auto' : 'career'] || [];
         const restoredOrderIndex = savedOrder.indexOf(actToRestore['활동명']);
         
         const studentActsInfo = newActivities
            .map((a, i) => ({ a, i }))
            .filter(({ a }) => a['학년'] === actToRestore['학년'] && a['이름'] === actToRestore['이름'] && a['입력영역'] === actToRestore['입력영역'] && !a.isDeleted);
         
         if (restoredOrderIndex !== -1 && studentActsInfo.length > 0) {
            let precedingItemGlobalIndex = -1;
            let maxPrecedingOrderIndex = -1;
            
            for (const item of studentActsInfo) {
               const orderIdx = savedOrder.indexOf(item.a['활동명']);
               if (orderIdx !== -1 && orderIdx < restoredOrderIndex) {
                  if (orderIdx > maxPrecedingOrderIndex) {
                     maxPrecedingOrderIndex = orderIdx;
                     precedingItemGlobalIndex = item.i;
                  }
               }
            }
            
            if (precedingItemGlobalIndex !== -1) {
               insertGlobalIndex = precedingItemGlobalIndex + 1;
            } else {
               insertGlobalIndex = studentActsInfo[0].i;
            }
         } else if (studentActsInfo.length > 0) {
            insertGlobalIndex = studentActsInfo[studentActsInfo.length - 1].i + 1;
         }
      }
      
      if (insertGlobalIndex !== -1) {
         newActivities.splice(insertGlobalIndex, 0, actToRestore);
      } else {
         newActivities.push(actToRestore);
      }
      
      return newActivities;
    });
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(aiDisplayText ?? displayText);
    alert("복사되었습니다!");
  };
  
  // Activity-level AI shortening handlers
  const handleActivityAiShorten = async () => {
    if (selectedForShortening.size === 0) return;
    const selectedActs = activeStudentActivities.filter(a => selectedForShortening.has(a._localId));
    if (selectedActs.length === 0) return;

    const totalSelectedBytes = selectedActs.reduce((sum, a) => sum + getByteLength(a['입력내용'] || ''), 0);
    const excess = Math.max(0, totalBytes - targetBytes);
    if (excess === 0) {
      alert("현재 바이트 수가 초과되지 않아 요약할 필요가 없습니다.");
      return;
    }

    setShorteningActivityIds(new Set(selectedActs.map(a => a._localId)));

    try {
      await Promise.all(selectedActs.map(async (act) => {
        const currentBytes = getByteLength(act['입력내용'] || '');
        const reduction = excess * (currentBytes / totalSelectedBytes);
        const actTargetBytes = Math.max(30, Math.floor(currentBytes - reduction));

        const response = await fetch('/api/ai/shorten', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: act['입력내용'], targetBytes: actTargetBytes }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'AI 요약 실패');
        if (data.shortened) {
          setActivityAiStates(prev => ({
            ...prev,
            [act._localId]: { aiContent: data.shortened, selectedVersions: {} },
          }));
        }
      }));
    } catch (err: any) {
      alert(`AI 요약 오류: ${err.message}`);
    } finally {
      setShorteningActivityIds(new Set());
      setSelectedForShortening(new Set());
    }
  };

  const handleSelectActivityVersion = (localId: number, groupIndex: number, version: 'ai' | 'original') => {
    setActivityAiStates(prev => {
      const state = prev[localId];
      if (!state) return prev;
      return { ...prev, [localId]: { ...state, selectedVersions: { ...state.selectedVersions, [groupIndex]: version } } };
    });
  };

  const handleAcceptActivityAi = (localId: number) => {
    const aiState = activityAiStates[localId];
    if (!aiState) return;
    const original = activities.find(a => a._localId === localId)?.['입력내용'] || '';
    const diff = Diff.diffChars(original, aiState.aiContent);
    const groups = buildChangeGroups(diff);
    const effective = groups.reduce((acc, g) => {
      if (g.type === 'unchanged') return acc + (g.text || '');
      const selected = aiState.selectedVersions[g.index] ?? 'ai';
      return acc + (selected === 'ai' ? g.ai : g.original);
    }, '');
    handleContentChange(localId, effective);
    setActivityAiStates(prev => { const n = { ...prev }; delete n[localId]; return n; });
  };

  const handleDiscardActivityAi = (localId: number) => {
    setActivityAiStates(prev => { const n = { ...prev }; delete n[localId]; return n; });
  };

  const handleAddRecommendation = (recName: string, recContent: string) => {
    if (!activeStudent) {
      alert("학생을 먼저 선택해주세요.");
      return;
    }

    const alreadyExists = activeStudentActivities.some(a => a['활동명'] === recName);
    if (alreadyExists) {
      alert(`'${recName}' 활동이 이미 추가되어 있습니다.`);
      return;
    }
    
    const newActivity = {
      '학년': activeStudent.grade,
      '반': activeStudent.class,
      '번호': activeStudent.num,
      '이름': activeStudent.name,
      '입력영역': activeTab,
      '활동명': recName,
      '입력내용': recContent,
      'byte': getByteLength(recContent),
      '작성교사': "",
      _localId: Date.now() + Math.random(),
      _fromRecommendation: true,
      _recOriginalContent: recContent,
    };
    
    const studentKey = `${activeStudent.grade}-${activeStudent.class}-${activeStudent.num}-${activeStudent.name}`;
    setActivities(prev => insertActivitiesByDate(prev, [newActivity], studentKey, activeTab));
    setExpandedActs(prev => ({ ...prev, [newActivity._localId]: true }));
  };

  const handleRandomRecommendation = () => {
    if (!activeStudent) {
      alert("학생을 먼저 선택해주세요.");
      return;
    }

    const usedTitles = new Set(activeStudentActivities.map((a: any) => a['활동명']));

    // 현재 탭에 해당하는 추천 문구만 대상
    const tabRecs = recommendations.filter(rec => {
      const matchTab = !rec['입력영역'] || rec['입력영역'] === activeTab || rec['입력영역'] === '공통';
      return matchTab;
    });

    // 아직 추가되지 않은 활동명 그룹별로 묶기
    const availableGroups = new Map<string, any[]>();
    tabRecs.forEach((rec: any) => {
      const title = rec['활동명'] || "이름 없는 활동";
      if (usedTitles.has(title)) return;
      if (!availableGroups.has(title)) availableGroups.set(title, []);
      availableGroups.get(title)!.push(rec);
    });

    if (availableGroups.size === 0) {
      alert("추가할 수 있는 추천 문구가 없습니다.");
      return;
    }

    // 학급 동료 계산 (랜덤 배정 우선순위용)
    const classmatesForRandom = students.filter(
      (s: any) => s.grade === activeStudent.grade && s.class === activeStudent.class && s.id !== activeStudentId
    );
    const getUseCountForRandom = (title: string, content: string) =>
      classmatesForRandom.filter((s: any) =>
        activities.some((a: any) =>
          a['학년'] === s.grade && a['반'] === s.class &&
          a['번호'] === s.num && a['이름'] === s.name &&
          a['활동명'] === title && a['입력내용'] === content && !a.isDeleted
        )
      ).length;

    // 각 그룹에서 랜덤 변형 1개 선택 후 후보 목록 생성
    const candidates: { title: string; content: string; bytes: number; useCount: number }[] = [];
    availableGroups.forEach((recs, title) => {
      const pick = recs[Math.floor(Math.random() * recs.length)];
      const content = pick['활동내용'] || "";
      const bytes = getByteLength(content);
      const useCount = getUseCountForRandom(title, content);
      candidates.push({ title, content, bytes, useCount });
    });

    // 미사용(useCount=0) 우선, 그 다음 사용 횟수 적은 순 → 각 그룹 내 랜덤성 유지를 위해 동점끼리는 셔플
    const shuffleGroup = (arr: typeof candidates) => [...arr].sort(() => Math.random() - 0.5);
    const unused = shuffleGroup(candidates.filter(c => c.useCount === 0));
    const used = shuffleGroup(candidates.filter(c => c.useCount > 0)).sort((a, b) => a.useCount - b.useCount);
    const prioritized = [...unused, ...used];

    // 남은 바이트 내에서 최대 3개 선택
    const selected: typeof candidates = [];
    let usedBytes = 0;
    for (const cand of prioritized) {
      if (selected.length >= 3) break;
      if (usedBytes + cand.bytes <= remainingBytes) {
        selected.push(cand);
        usedBytes += cand.bytes;
      }
    }

    if (selected.length === 0) {
      alert("남은 바이트 내에서 추가할 수 있는 추천 문구가 없습니다.");
      return;
    }

    // 한 번에 추가
    const newActivities = selected.map(({ title, content }) => ({
      '학년': activeStudent.grade,
      '반': activeStudent.class,
      '번호': activeStudent.num,
      '이름': activeStudent.name,
      '입력영역': activeTab,
      '활동명': title,
      '입력내용': content,
      'byte': getByteLength(content),
      '작성교사': "",
      _localId: Date.now() + Math.random(),
      _fromRecommendation: true,
      _recOriginalContent: content,
    }));

    const studentKey = `${activeStudent.grade}-${activeStudent.class}-${activeStudent.num}-${activeStudent.name}`;
    setActivities(prev => insertActivitiesByDate(prev, newActivities, studentKey, activeTab));
    setExpandedActs(prev => {
      const next = { ...prev };
      newActivities.forEach(a => { next[a._localId] = true; });
      return next;
    });

    if (!showRecommendations) setShowRecommendations(true);
  };

  const onDragEnd = (result: any) => {
    if (!result.destination) return;
    
    const startIndex = result.source.index;
    const endIndex = result.destination.index;
    if (startIndex === endIndex) return;
    
    const originalIndices = currentStudentActivities.map(act => activities.findIndex(a => a._localId === act._localId));
    
    const newCurrent = Array.from(currentStudentActivities);
    const [removed] = newCurrent.splice(startIndex, 1);
    newCurrent.splice(endIndex, 0, removed);
    
    setActivities(prev => {
      const newActivities = [...prev];
      const sortedOriginalIndices = [...originalIndices].sort((a,b)=>a-b);
      sortedOriginalIndices.forEach((globalIndex, i) => {
        newActivities[globalIndex] = newCurrent[i];
      });
      return newActivities;
    });
  };

  const handleCancelUpload = async () => {
    if (!window.confirm("업로드된 활동 데이터 전체를 서버에서 삭제하시겠습니까?\n삭제 후 페이지가 새로고침됩니다.")) return;
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 20000);
      const res = await fetch("/api/sheets", { method: "DELETE", signal: controller.signal });
      clearTimeout(timeoutId);
      const result = await res.json();
      if (!res.ok) throw new Error(result.error);
      localStorage.removeItem('recordAssistant_activities');
      alert("업로드 데이터가 삭제되었습니다. 페이지를 새로고침합니다.");
      fetchData(true);
    } catch (err: any) {
      alert("업로드 취소 중 오류가 발생했습니다: " + err.message);
    }
  };

  const handleReset = async () => {
    if (!activeStudent) return;
    if (window.confirm(`${activeStudent.name} 학생의 수정된 내용을 삭제하고 원본 데이터로 되돌리시겠습니까?\n\n저장된 수정 기록(자율/진로수정, 추가문구수정)도 함께 삭제됩니다.`)) {
      try {
        setIsSaving(true);
        
        // 1. 서버에서 수정된 데이터 삭제
        const res = await fetch('/api/sheets/restore', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            grade: activeStudent.grade,
            classNum: activeStudent.class,
            studentNum: activeStudent.num,
            studentName: activeStudent.name
          })
        });

        const result = await res.json();
        if (!res.ok) throw new Error(result.error);

        // 2. 클라이언트 상태를 원본으로 되돌리기
        const studentKey = `${activeStudent.grade}-${activeStudent.class}-${activeStudent.num}-${activeStudent.name}`;
        
        setActivities(prev => {
          const others = prev.filter(act => {
            const k = `${act['학년']}-${act['반']}-${act['번호']}-${act['이름']}`;
            return k !== studentKey;
          });
          
          const originals = originalActivities.filter(act => {
            const k = `${act['학년']}-${act['반']}-${act['번호']}-${act['이름']}`;
            return k === studentKey;
          });
          
          return [...others, ...originals];
        });

        // 3. 저장 시간 정보도 업데이트
        const classData = await fetchClassData();
        const savedAtData: Record<string, string> = {};
        classData.forEach((row: any) => {
          if (row['저장시간']) {
            const key = `${row['학년']}-${row['반']}-${row['번호']}-${row['이름']}`;
            savedAtData[key] = row['저장시간'];
          }
        });
        setSheetSavedAtMap(prev => ({ ...prev, ...savedAtData }));

        alert(`${activeStudent.name} 학생의 데이터가 원본으로 복원되었습니다.\n${result.message}`);
        
      } catch (err: any) {
        alert("원본 복원 중 오류가 발생했습니다: " + err.message);
      } finally {
        setIsSaving(false);
      }
    }
  };

  const openOrderModal = () => {
    if (!activeStudent) return;
    const classKey = `${activeStudent.grade}-${activeStudent.class}`;
    const classStudents = students.filter(s => s.grade === activeStudent.grade && s.class === activeStudent.class);
    
    const autoSet = new Set<string>();
    const careerSet = new Set<string>();
    
    classStudents.forEach(student => {
      activities.forEach(act => {
        if (act['학년'] === student.grade && act['반'] === student.class && act['번호'] === student.num && act['이름'] === student.name) {
          if (act['입력영역'] === '자율활동') autoSet.add(act['활동명']);
          if (act['입력영역'] === '진로활동') careerSet.add(act['활동명']);
        }
      });
    });
    
    let autoList = Array.from(autoSet);
    let careerList = Array.from(careerSet);
    
    if (globalOrders[classKey]) {
      const { auto: savedAuto, career: savedCareer } = globalOrders[classKey];
      
      autoList.sort((a, b) => {
        const iA = savedAuto.indexOf(a);
        const iB = savedAuto.indexOf(b);
        if (iA !== -1 && iB !== -1) return iA - iB;
        if (iA !== -1) return -1;
        if (iB !== -1) return 1;
        return 0;
      });
      
      careerList.sort((a, b) => {
        const iA = savedCareer.indexOf(a);
        const iB = savedCareer.indexOf(b);
        if (iA !== -1 && iB !== -1) return iA - iB;
        if (iA !== -1) return -1;
        if (iB !== -1) return 1;
        return 0;
      });
    }
    
    setClassAutoActs(autoList);
    setClassCareerActs(careerList);
    setShowOrderModal(true);
  };

  const onDragEndModal = (result: any) => {
    if (!result.destination) return;
    
    const sourceId = result.source.droppableId;
    const destId = result.destination.droppableId;
    
    if (sourceId !== destId) return;
    
    const startIndex = result.source.index;
    const endIndex = result.destination.index;
    if (startIndex === endIndex) return;
    
    if (sourceId === "modal-auto") {
      const newList = Array.from(classAutoActs);
      const [removed] = newList.splice(startIndex, 1);
      newList.splice(endIndex, 0, removed);
      setClassAutoActs(newList);
    } else if (sourceId === "modal-career") {
      const newList = Array.from(classCareerActs);
      const [removed] = newList.splice(startIndex, 1);
      newList.splice(endIndex, 0, removed);
      setClassCareerActs(newList);
    }
  };

  const handleApplyGlobalOrder = () => {
    if (!activeStudent) return;
    const classKey = `${activeStudent.grade}-${activeStudent.class}`;
    
    // Save the established order to state
    setGlobalOrders(prev => ({
      ...prev,
      [classKey]: {
        auto: classAutoActs,
        career: classCareerActs
      }
    }));
    
    setActivities(prev => {
      const newActivities = [...prev];
      const classStudents = students.filter(s => s.grade === activeStudent.grade && s.class === activeStudent.class);
      
      classStudents.forEach(student => {
        const studentAutoIndices = newActivities.map((act, idx) => ({act, idx})).filter(({act}) => act['학년'] === student.grade && act['반'] === student.class && act['번호'] === student.num && act['이름'] === student.name && act['입력영역'] === '자율활동').map(i => i.idx);
        const studentCareerIndices = newActivities.map((act, idx) => ({act, idx})).filter(({act}) => act['학년'] === student.grade && act['반'] === student.class && act['번호'] === student.num && act['이름'] === student.name && act['입력영역'] === '진로활동').map(i => i.idx);
        
        if (studentAutoIndices.length > 0) {
          const autoActs = studentAutoIndices.map(idx => newActivities[idx]);
          autoActs.sort((a, b) => {
            const iA = classAutoActs.indexOf(a['활동명']);
            const iB = classAutoActs.indexOf(b['활동명']);
            if (iA !== -1 && iB !== -1) return iA - iB;
            if (iA !== -1) return -1;
            if (iB !== -1) return 1;
            return 0;
          });
          const sortedAuto = [...studentAutoIndices].sort((a,b)=>a-b);
          sortedAuto.forEach((gIdx, i) => newActivities[gIdx] = autoActs[i]);
        }
        
        if (studentCareerIndices.length > 0) {
          const careerActs = studentCareerIndices.map(idx => newActivities[idx]);
          careerActs.sort((a, b) => {
            const iA = classCareerActs.indexOf(a['활동명']);
            const iB = classCareerActs.indexOf(b['활동명']);
            if (iA !== -1 && iB !== -1) return iA - iB;
            if (iA !== -1) return -1;
            if (iB !== -1) return 1;
            return 0;
          });
          const sortedCareer = [...studentCareerIndices].sort((a,b)=>a-b);
          sortedCareer.forEach((gIdx, i) => newActivities[gIdx] = careerActs[i]);
        }
      });
      return newActivities;
    });
    
    setShowOrderModal(false);
    alert("학급 전체의 자율/진로활동 순서가 일괄 적용되었습니다!");
  };

  // 수정된 활동 감지 + targetSheet 결정
  // - _fromRecommendation 없는 활동: originalActivities 대비 변경 → 자율/진로수정
  // - _fromRecommendation 있는 활동: _recOriginalContent 대비 변경 → 추가문구수정
  const detectModifiedActivities = (targetActivities: any[]) => {
    const origMap = new Map<string, string>(
      originalActivities.map((a: any) => [
        `${a['학년']}||${a['반']}||${a['번호']}||${a['이름']}||${a['활동명'] ?? ''}||${a['입력영역']}`,
        a['입력내용'] ?? '',
      ])
    );

    const sheet1: any[] = [];
    const sheet2: any[] = [];

    for (const a of targetActivities) {
      if (a.isDeleted) continue;
      const currentContent = a['입력내용'] ?? '';

      if (a._fromRecommendation) {
        // 창체문구 추가 활동: 추가 당시 원본(_recOriginalContent)과 비교
        const recOrig = a._recOriginalContent ?? '';
        if (currentContent !== recOrig) {
          sheet2.push(a);
        }
      } else {
        // 일반 활동(자율/진로 포함): originalActivities 원본과 비교
        const key = `${a['학년']}||${a['반']}||${a['번호']}||${a['이름']}||${a['활동명'] ?? ''}||${a['입력영역']}`;
        const orig = origMap.get(key);
        if (orig !== undefined && orig !== currentContent) {
          sheet1.push(a);
        }
      }
    }

    return { sheet1, sheet2 };
  };

  // 수정된 활동을 자율/진로수정, 추가문구수정에 저장
  const saveModifiedActivities = async (targetActivities: any[]) => {
    const { sheet1, sheet2 } = detectModifiedActivities(targetActivities);
    if (sheet1.length === 0 && sheet2.length === 0) return;

    const toPayload = (a: any, targetSheet: string) => ({
      학년: String(a['학년'] ?? ''),
      반: String(a['반'] ?? ''),
      번호: String(a['번호'] ?? ''),
      이름: String(a['이름'] ?? ''),
      활동명: String(a['활동명'] ?? ''),
      입력내용: String(a['입력내용'] ?? ''),
      입력영역: String(a['입력영역'] ?? ''),
      targetSheet,
    });

    const modifications = [
      ...sheet1.map(a => toPayload(a, '자율/진로수정')),
      ...sheet2.map(a => toPayload(a, '추가문구수정')),
    ];

    await fetch('/api/sheets/modify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ modifications }),
    });
  };

  // globalOrders 기준으로 활동을 정렬해서 텍스트 합치기
  const buildActsText = (studentActs: any[], area: '자율활동' | '진로활동', classKey: string): string => {
    const order = globalOrders[classKey]?.[area === '자율활동' ? 'auto' : 'career'] || [];
    const filtered = studentActs.filter(a => a['입력영역'] === area && !a.isDeleted);
    const sorted = [...filtered].sort((a, b) => {
      const iA = order.indexOf(a['활동명']);
      const iB = order.indexOf(b['활동명']);
      if (iA !== -1 && iB !== -1) return iA - iB;
      if (iA !== -1) return -1;
      if (iB !== -1) return 1;
      return 0;
    });
    return sorted.map(a => a['입력내용']).filter(Boolean).join(" ");
  };

  const formatSavedAt = (iso: string) => {
    const d = new Date(iso);
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    return `${mm}/${dd} ${hh}:${min}`;
  };

  // 학급 시트에서 저장시간 데이터 가져오기
  const fetchClassData = async () => {
    try {
      const res = await fetch(`/api/sheets/class-data?grade=${grade}&classNum=${classNum}`);
      if (res.ok) {
        const data = await res.json();
        return data.rows || [];
      }
    } catch (error) {
      console.error('Failed to fetch class data:', error);
    }
    return [];
  };

  const handleSaveIndividual = async () => {
    if (!activeStudent) return;
    
    setIsSaving(true);
    try {
      const studentActs = activities.filter(act => 
        act['학년'] === activeStudent.grade && 
        act['반'] === activeStudent.class && 
        act['번호'] === activeStudent.num && 
        act['이름'] === activeStudent.name
      );
      
      const classKey = `${activeStudent.grade}-${activeStudent.class}`;
      let autoActs: string;
      let careerActs: string;
      if (finalText) {
        autoActs = finalText;
        careerActs = '';
      } else {
        autoActs = buildActsText(studentActs, '자율활동', classKey);
        careerActs = buildActsText(studentActs, '진로활동', classKey);
      }
      
      const payloadData = [{
        '학년': activeStudent.grade,
        '반': activeStudent.class,
        '번호': activeStudent.num,
        '이름': activeStudent.name,
        '자율활동': autoActs,
        '진로활동': careerActs
      }];

      const res = await fetch("/api/sheets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          grade: activeStudent.grade,
          classNum: activeStudent.class,
          data: payloadData,
          isIndividual: true,
          studentInfo: {
            num: activeStudent.num,
            name: activeStudent.name
          }
        })
      });
      
      const result = await res.json();
      if (!res.ok) throw new Error(result.error);

      // 수정된 활동 내용을 자율/진로수정, 추가문구수정에 반영 (실패해도 주 저장은 완료)
      await saveModifiedActivities(studentActs).catch(console.error);

      // 시트 저장시간 데이터 업데이트
      const classData = await fetchClassData();
      const savedAtData: Record<string, string> = {};
      classData.forEach((row: any) => {
        if (row['저장시간']) {
          const key = `${row['학년']}-${row['반']}-${row['번호']}-${row['이름']}`;
          savedAtData[key] = row['저장시간'];
        }
      });
      setSheetSavedAtMap(prev => ({ ...prev, ...savedAtData }));

      // 활동별 수정 상태 다시 확인 (일괄 처리)
      try {
        const res = await fetch('/api/sheets/check-modified-batch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            grade: activeStudent.grade,
            classNum: activeStudent.class
          })
        });

        const result = await res.json();
        const modifiedActivities = result.modifiedActivities || [];
        
        const updatedModifiedMap: Record<number, boolean> = {};
        activities.forEach((activity: any) => {
          const key = `${activity['번호']}-${activity['이름']}-${activity['활동명']}-${activity['입력영역']}`;
          updatedModifiedMap[activity._localId] = modifiedActivities.includes(key);
        });
        setActivityModifiedMap(updatedModifiedMap);
      } catch (error) {
        console.error('수정 상태 확인 중 오류:', error);
      }
      
      alert(`${activeStudent.name} 학생의 데이터가 성공적으로 개별 저장되었습니다!`);
    } catch (err: any) {
      alert("개별 저장 중 오류가 발생했습니다: " + err.message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleSave = async () => {
    if (!activeStudent) return;
    
    setIsSaving(true);
    try {
      const classStudents = students.filter(s => s.grade === activeStudent.grade && s.class === activeStudent.class);
      const classKey = `${activeStudent.grade}-${activeStudent.class}`;
      
      const payloadData = classStudents.map(student => {
        const studentActs = activities.filter(act => 
          act['학년'] === student.grade && 
          act['반'] === student.class && 
          act['번호'] === student.num && 
          act['이름'] === student.name
        );
        
        const isActiveStudent =
          student.grade === activeStudent.grade &&
          student.class === activeStudent.class &&
          student.num === activeStudent.num &&
          student.name === activeStudent.name;

        let autoActs: string;
        let careerActs: string;
        if (isActiveStudent && finalText) {
          autoActs = finalText;
          careerActs = '';
        } else {
          autoActs = buildActsText(studentActs, '자율활동', classKey);
          careerActs = buildActsText(studentActs, '진로활동', classKey);
        }
        
        return {
          '학년': student.grade,
          '반': student.class,
          '번호': student.num,
          '이름': student.name,
          '자율활동': autoActs,
          '진로활동': careerActs
        };
      });

      const res = await fetch("/api/sheets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          grade: activeStudent.grade,
          classNum: activeStudent.class,
          data: payloadData
        })
      });
      
      const result = await res.json();
      if (!res.ok) throw new Error(result.error);

      // 해당 반 전체 학생의 수정된 활동 내용을 자율/진로수정, 추가문구수정에 반영
      const classActivities = activities.filter(act =>
        act['학년'] === activeStudent.grade && act['반'] === activeStudent.class
      );
      await saveModifiedActivities(classActivities).catch(console.error);

      // 시트 저장시간 데이터 업데이트
      const classData = await fetchClassData();
      const savedAtData: Record<string, string> = {};
      classData.forEach((row: any) => {
        if (row['저장시간']) {
          const key = `${row['학년']}-${row['반']}-${row['번호']}-${row['이름']}`;
          savedAtData[key] = row['저장시간'];
        }
      });
      setSheetSavedAtMap(prev => ({ ...prev, ...savedAtData }));

      // 활동별 수정 상태 다시 확인 (일괄 처리)
      try {
        const res = await fetch('/api/sheets/check-modified-batch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            grade: activeStudent.grade,
            classNum: activeStudent.class
          })
        });

        const result = await res.json();
        const modifiedActivities = result.modifiedActivities || [];
        
        const updatedModifiedMap: Record<number, boolean> = {};
        activities.forEach((activity: any) => {
          const key = `${activity['번호']}-${activity['이름']}-${activity['활동명']}-${activity['입력영역']}`;
          updatedModifiedMap[activity._localId] = modifiedActivities.includes(key);
        });
        setActivityModifiedMap(updatedModifiedMap);
      } catch (error) {
        console.error('수정 상태 확인 중 오류:', error);
      }
      
      alert(`${activeStudent.grade}학년 ${activeStudent.class}반 데이터가 '${result.sheetTitle}' 시트에 성공적으로 저장되었습니다!`);
    } catch (err: any) {
      alert("저장 중 오류가 발생했습니다: " + err.message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleAiShorten = async () => {
    if (!activeStudent || !combinedText.trim()) return;

    if (!isOverLimit) {
      alert("현재 바이트 수가 초과되지 않아 요약할 필요가 없습니다.");
      return;
    }

    setIsShortening(true);
    setAiBaseText(null);
    setRestoredChunks(new Set());
    try {
      const response = await fetch('/api/ai/shorten', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: combinedText, targetBytes }),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'AI 요약에 실패했습니다.');

      if (data.shortened) {
        setAiBaseText(data.shortened);
      }
    } catch (error: any) {
      alert(`오류: ${error.message}`);
    } finally {
      setIsShortening(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-100">
        <div className="text-center">
          <div className="text-4xl mb-4 animate-spin">⏳</div>
          <h2 className="text-xl font-bold text-gray-700">스프레드시트에서 데이터를 불러오는 중입니다...</h2>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-100">
        <div className="glass-panel p-8 max-w-lg text-center border-red-200">
          <div className="text-4xl mb-4 text-red-500">⚠️</div>
          <h2 className="text-xl font-bold text-gray-800 mb-2">연동 오류 발생</h2>
          <p className="text-red-600 mb-4">{error}</p>
          <p className="text-sm text-gray-500 text-left">
            1. <code>.env.local</code> 파일의 설정이 올바른지 확인해주세요.<br/>
            2. 구글 스프레드시트에 서비스 계정 이메일이 '편집자'로 공유되어 있는지 확인해주세요.<br/>
            3. 데이터 구조(열 이름)가 기획서와 동일한지 확인해주세요.
          </p>
        </div>
      </div>
    );
  }

  const activeStudent = students.find(s => s.id === activeStudentId);

  const filteredRecommendations = recommendations.filter(rec => {
    const matchTab = !rec['입력영역'] || rec['입력영역'] === activeTab || rec['입력영역'] === '공통';
    if (!matchTab) return false;
    
    if (recFilter === "추천") {
      const byteLen = getByteLength(rec['활동내용'] || "");
      if (byteLen > remainingBytes) return false;
    }
    
    return true;
  });

  const groupedRecommendations = filteredRecommendations.reduce((acc, rec) => {
    const title = rec['활동명'] || "이름 없는 활동";
    if (!acc.has(title)) acc.set(title, []);
    acc.get(title).push(rec);
    return acc;
  }, new Map<string, any[]>());

  // 같은 학급에서 특정 창체 문구(활동명+내용)를 사용한 학생 수 계산
  const classmates = activeStudent
    ? students.filter(s => s.grade === activeStudent.grade && s.class === activeStudent.class && s.id !== activeStudentId)
    : [];

  const getClassUseCount = (title: string, content: string) =>
    classmates.filter(s =>
      activities.some(a =>
        a['학년'] === s.grade && a['반'] === s.class &&
        a['번호'] === s.num && a['이름'] === s.name &&
        a['활동명'] === title && a['입력내용'] === content && !a.isDeleted
      )
    ).length;

  const getUseCountStyle = (count: number) => {
    if (count === 0) return { btn: "bg-gray-50 text-gray-600 hover:bg-gray-100", badge: null };
    if (count === 1) return { btn: "bg-yellow-50 text-yellow-700 hover:bg-yellow-100", badge: "1명 사용" };
    if (count === 2) return { btn: "bg-orange-50 text-orange-600 hover:bg-orange-100", badge: "2명 사용" };
    return { btn: "bg-red-50 text-red-600 hover:bg-red-100", badge: `${count}명 사용` };
  };

  return (
    <div className="flex h-screen p-5 gap-5 w-full">
      {/* Sidebar */}
      <aside 
        className={`${isSidebarOpen ? 'w-1/4 min-w-[260px] max-w-[320px] flex flex-col' : 'w-0 hidden'} shrink-0 glass-panel overflow-hidden transition-all duration-300`}
      >
        <header className="p-6 pb-4 border-b border-white/20">
          <div className="flex justify-between items-center mb-4">
            <div>
              <h1 className="text-xl font-bold text-white drop-shadow-md">생기부 도우미 ✨</h1>
              <p className="text-xs text-white/60 mt-0.5">{grade}학년 {classNum}반</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  sessionStorage.removeItem(`classAuth_${grade}_${classNum}`);
                  router.push('/');
                }}
                className="text-white/50 hover:text-white transition-colors text-xs px-2 py-1 rounded hover:bg-white/10"
                title="나가기"
              >
                나가기
              </button>
              <button onClick={() => setIsSidebarOpen(false)} className="text-white/70 hover:text-white transition-colors text-sm" title="사이드바 숨기기">◀</button>
            </div>
          </div>
          <div className="flex bg-white/90 rounded-lg px-3 py-2 items-center">
            <input type="text" placeholder="학생 검색..." className="bg-transparent border-none outline-none flex-1 text-sm text-gray-800" />
            <button className="text-gray-400 hover:text-gray-600 transition-colors">🔍</button>
          </div>
        </header>
        <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-4">
          {Array.from<[string, any[]]>(
            students.reduce((acc, student) => {
              const groupKey = `${student.grade}학년 ${student.class}반`;
              if (!acc.has(groupKey)) acc.set(groupKey, []);
              acc.get(groupKey).push(student);
              return acc;
            }, new Map<string, any[]>()).entries()
          ).map(([groupKey, groupStudents]) => (
            <div key={groupKey} className="flex flex-col gap-2">
              <div 
                className="text-xs font-bold text-gray-500 uppercase tracking-wider px-2 pt-2 cursor-pointer flex justify-between items-center hover:text-primary transition-colors"
                onClick={() => toggleGroup(groupKey)}
              >
                <span>{groupKey}</span>
                <span className="text-[0.6rem]">{expandedGroups[groupKey] ? "▲" : "▼"}</span>
              </div>
              {expandedGroups[groupKey] && groupStudents.map((student: any) => {
                const studentActs = activities.filter(act => 
                  act['학년'] === student.grade && 
                  act['반'] === student.class && 
                  act['번호'] === student.num && 
                  act['이름'] === student.name &&
                  act['입력영역'] === activeTab
                );
                const studentBytes = studentActs.reduce((acc, act) => acc + getByteLength(act['입력내용'] || ""), 0);
                const isOverLimit = studentBytes > targetBytes;

                return (
                  <div
                    key={student.id}
                    onClick={() => {
                      setActiveStudentId(student.id);
                      setAiBaseText(null);
                      setRestoredChunks(new Set());
                      setFinalText(null);
                    }}
                    className={`flex items-center p-3 rounded-xl cursor-pointer transition-all ${
                      activeStudentId === student.id
                        ? "bg-white shadow-sm border-l-4 border-primary"
                        : "bg-white/50 hover:bg-white/80"
                    }`}
                  >
                    <div className={`w-9 h-9 rounded-full flex items-center justify-center font-bold mr-3 shrink-0 ${
                      isOverLimit ? "bg-red-100 text-red-500" : "bg-primary-light text-primary"
                    }`}>
                      {student.num}
                    </div>
                    <div className="flex flex-col flex-1 min-w-0">
                      <div className="flex justify-between items-center w-full">
                        <span className="font-semibold text-[0.95rem]">{student.name}</span>
                        <span className={`text-[0.7rem] font-mono px-1.5 py-0.5 rounded shrink-0 ${
                          isOverLimit ? "bg-red-50 text-red-500 font-bold" : "bg-gray-100 text-gray-500"
                        }`}>
                          {studentBytes}B
                        </span>
                      </div>
                      {sheetSavedAtMap[student.id] && (
                        <span className="text-[0.65rem] text-green-600 font-medium mt-0.5">
                          📋 {formatSavedAt(sheetSavedAtMap[student.id])} 저장
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col gap-5 min-w-0">
        {/* Header */}
        <header className="glass-panel flex justify-between items-center px-6 py-4">
          <div className="flex items-center gap-3">
            {!isSidebarOpen && (
              <button 
                onClick={() => setIsSidebarOpen(true)} 
                className="mr-2 text-gray-500 hover:text-primary transition-colors text-lg"
                title="사이드바 열기"
              >
                ▶
              </button>
            )}
            <h2 className="text-2xl font-bold">{activeStudent?.name || "학생 선택"}</h2>
            {activeStudent && (
              <span className="text-xs px-2 py-1 rounded-full bg-primary-light text-primary font-medium">
                {activeStudent.grade}학년 {activeStudent.class}반 {activeStudent.num}번
              </span>
            )}
          </div>
          {/* Byte Checker - compact */}
          {activeStudent && (
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 bg-white/80 border border-gray-200 rounded-xl px-4 py-2 shadow-sm">
                <span className="text-xs text-gray-400">바이트</span>
                <span className={`text-base font-bold font-mono ${isOverLimit ? "text-red-500" : "text-primary"}`}>{totalBytes}</span>
                <span className="text-xs text-gray-300">/</span>
                <span className="text-base font-bold font-mono text-gray-400">{targetBytes}</span>
                <div className="w-16 h-1.5 bg-gray-200 rounded-full overflow-hidden ml-1">
                  <div className={`h-full transition-all duration-300 rounded-full ${isOverLimit ? "bg-red-500" : "bg-primary"}`} style={{ width: `${progressPercent}%` }} />
                </div>
              </div>
            </div>
          )}

          <div className="flex gap-2">
            <button
              onClick={() => setShowUploadModal(true)}
              className="px-4 py-2 rounded-lg font-semibold text-sm bg-white border border-gray-200 text-gray-600 shadow-sm hover:bg-gray-50 transition-all flex items-center gap-1"
            >
              📂 데이터 업로드
            </button>
            <button
              onClick={handleCancelUpload}
              className="px-4 py-2 rounded-lg font-semibold text-sm bg-white border border-red-200 text-red-400 shadow-sm hover:bg-red-50 hover:text-red-600 transition-all flex items-center gap-1"
              title="업로드된 활동 데이터를 서버에서 전체 삭제"
            >
              🗑️ 업로드 취소
            </button>
            <button 
              onClick={handleReset}
              className="px-4 py-2 rounded-lg font-semibold text-sm bg-white border border-gray-200 text-gray-600 shadow-sm hover:bg-gray-50 transition-all flex items-center gap-1"
              title="수정된 내용을 삭제하고 원본으로 복원"
            >
              🔄 원본 복원
            </button>
            <button 
              onClick={openOrderModal}
              className="px-4 py-2 rounded-lg font-semibold text-sm bg-white border border-gray-200 text-gray-600 shadow-sm hover:bg-gray-50 transition-all flex items-center gap-1"
            >
              ⚙️ 학급 전체 순서 설정
            </button>
            <button 
              onClick={handleSaveIndividual}
              disabled={isSaving}
              className={`px-4 py-2 rounded-lg font-semibold text-sm text-white shadow-md transition-all flex items-center gap-2 ${isSaving ? 'bg-indigo-300 cursor-not-allowed' : 'bg-indigo-500 hover:bg-indigo-600'}`}
            >
              {isSaving ? "저장 중..." : "학생 개별 저장"}
            </button>
            <button 
              onClick={handleSave}
              disabled={isSaving}
              className={`px-4 py-2 rounded-lg font-semibold text-sm text-white shadow-md transition-all flex items-center gap-2 ${isSaving ? 'bg-gray-400 cursor-not-allowed' : 'bg-primary hover:bg-primary-hover'}`}
            >
              {isSaving ? "저장 중..." : "학급 전체 시트에 저장"}
            </button>
          </div>
        </header>

        {/* Editor Layout */}
        <div className="flex flex-1 gap-5 overflow-hidden">
          {/* Editor Section */}
          <section className="flex-[3] flex flex-col glass-panel p-5">
            {/* Tabs */}
            <div className="flex justify-between items-end mb-5 border-b-2 border-gray-200/50 pb-1">
              <div className="flex gap-2">
                <button
                  className={`px-4 py-2 font-semibold transition-colors relative ${activeTab === "자율활동" ? "text-primary" : "text-gray-500 hover:text-gray-700"}`}
                  onClick={() => { setActiveTab("자율활동"); setSelectedForShortening(new Set()); }}
                >
                  자율활동
                  {activeTab === "자율활동" && <div className="absolute bottom-[-3px] left-0 right-0 h-[3px] bg-primary rounded-t-sm" />}
                </button>
                <button
                  className={`px-4 py-2 font-semibold transition-colors relative ${activeTab === "진로활동" ? "text-primary" : "text-gray-500 hover:text-gray-700"}`}
                  onClick={() => { setActiveTab("진로활동"); setSelectedForShortening(new Set()); }}
                >
                  진로활동
                  {activeTab === "진로활동" && <div className="absolute bottom-[-3px] left-0 right-0 h-[3px] bg-primary rounded-t-sm" />}
                </button>
              </div>
              {/* 선택 AI 줄이기 - 초과 시 항상 표시 */}
              {isOverLimit && (
                selectedForShortening.size === 0 ? (
                  <span className="text-xs text-purple-400 font-medium flex items-center gap-1">
                    ✨ AI 분량 줄이기 — 활동을 선택하세요
                  </span>
                ) : (
                  <button
                    onClick={handleActivityAiShorten}
                    disabled={shorteningActivityIds.size > 0}
                    className={`text-xs px-3 py-1.5 rounded-lg font-bold transition-all shadow-sm flex items-center gap-1 ${
                      shorteningActivityIds.size > 0
                        ? "bg-gray-100 text-gray-400 cursor-not-allowed"
                        : "bg-purple-100 text-purple-700 hover:bg-purple-600 hover:text-white border border-purple-200"
                    }`}
                  >
                    {shorteningActivityIds.size > 0 ? "✨ 요약 중..." : `✨ 선택 ${selectedForShortening.size}개 AI 줄이기`}
                  </button>
                )
              )}
            </div>

            {/* Activities List */}
            <div className="flex-1 overflow-y-auto pr-2 flex flex-col gap-4">
              {(
                <DragDropContext onDragEnd={onDragEnd}>
                  <Droppable droppableId="activities">
                    {(provided) => (
                      <div {...provided.droppableProps} ref={provided.innerRef} className="flex flex-col gap-4">
                        {currentStudentActivities.map((act, index) => {
                          const aiState = activityAiStates[act._localId];
                          const isShorten = shorteningActivityIds.has(act._localId);
                          const isSelected = selectedForShortening.has(act._localId);
                          const aiDiffForAct = aiState ? Diff.diffChars(act['입력내용'] || '', aiState.aiContent) : null;
                          const aiChangeGroups = aiDiffForAct ? buildChangeGroups(aiDiffForAct) : null;
                          const aiEffectiveBytes = aiChangeGroups
                            ? getByteLength(aiChangeGroups.reduce((acc, g) => {
                                if (g.type === 'unchanged') return acc + (g.text || '');
                                const sel = aiState!.selectedVersions[g.index] ?? 'ai';
                                return acc + (sel === 'ai' ? g.ai : g.original);
                              }, ''))
                            : 0;

                          return (
                          <Draggable key={act._localId.toString()} draggableId={act._localId.toString()} index={index}>
                            {(provided) => (
                              <div
                                ref={provided.innerRef}
                                {...provided.draggableProps}
                                className={`rounded-xl shadow-sm p-4 flex flex-col gap-2 border transition-all ${
                                  act.isDeleted
                                    ? "bg-gray-100 border-gray-200 opacity-60 grayscale"
                                    : aiState
                                    ? "bg-purple-50/40 border-purple-200"
                                    : isSelected
                                    ? "bg-blue-50/40 border-blue-200"
                                    : "bg-white border-gray-100 hover:shadow-md"
                                }`}
                              >
                                {/* Card Header */}
                                <div className="flex justify-between items-center cursor-pointer" onClick={() => !act.isDeleted && !aiState && toggleAct(act._localId)}>
                                  <div className="flex items-center gap-2 flex-1">
                                    {/* Checkbox for AI shortening - 초과 시에만 표시 */}
                                    {!act.isDeleted && !aiState && isOverLimit && (
                                      <input
                                        type="checkbox"
                                        checked={isSelected}
                                        onChange={(e) => {
                                          e.stopPropagation();
                                          setSelectedForShortening(prev => {
                                            const next = new Set(prev);
                                            if (next.has(act._localId)) next.delete(act._localId);
                                            else next.add(act._localId);
                                            return next;
                                          });
                                        }}
                                        onClick={(e) => e.stopPropagation()}
                                        className="w-3.5 h-3.5 accent-purple-500 cursor-pointer shrink-0"
                                      />
                                    )}
                                    <div {...provided.dragHandleProps} className={`cursor-grab flex items-center px-1 transition-colors ${act.isDeleted ? "text-gray-300 pointer-events-none" : "text-gray-400 hover:text-gray-600"}`}>⋮⋮</div>
                                    <div className={`font-semibold text-[0.95rem] truncate transition-colors ${
                                      act.isDeleted ? "text-gray-400 line-through" : "text-gray-800 hover:text-primary"
                                    }`}>
                                      {act['활동명']}
                                    </div>
                                    {!act.isDeleted && !aiState && (
                                      <button
                                        onClick={(e) => { e.stopPropagation(); handleDeleteActivity(act._localId); }}
                                        className="text-gray-300 hover:text-red-500 transition-colors text-base leading-none"
                                        title="삭제"
                                      >
                                        🗑️
                                      </button>
                                    )}
                                  </div>
                                  <div className="flex items-center gap-3 shrink-0 ml-4">
                                    {act.isDeleted ? (
                                      <button
                                        onClick={(e) => { e.stopPropagation(); handleRestoreDeletedActivity(act._localId); }}
                                        className="text-xs bg-white text-gray-500 border border-gray-300 hover:bg-gray-50 hover:text-primary px-3 py-1 rounded font-bold transition-all shadow-sm flex items-center gap-1"
                                      >
                                        ➕ 다시 추가
                                      </button>
                                    ) : aiState ? (
                                      <>
                                        <span className="text-xs font-mono text-purple-600 font-bold">{aiEffectiveBytes}B</span>
                                        <span className="text-xs font-mono text-gray-400 line-through">{getByteLength(act['입력내용'])}B</span>
                                        <button onClick={(e) => { e.stopPropagation(); handleAcceptActivityAi(act._localId); }} className="text-xs bg-purple-600 text-white px-2 py-1 rounded font-bold hover:bg-purple-700 transition-colors">✅ 반영</button>
                                        <button onClick={(e) => { e.stopPropagation(); handleDiscardActivityAi(act._localId); }} className="text-xs bg-white text-gray-500 border border-gray-200 px-2 py-1 rounded font-bold hover:bg-gray-50 transition-colors">✕</button>
                                      </>
                                    ) : isShorten ? (
                                      <span className="text-xs text-purple-500 font-bold animate-pulse">✨ 요약 중...</span>
                                    ) : (
                                      <>
                                        <span className="text-xs text-gray-400 font-mono">{getByteLength(act['입력내용'])} Byte</span>
                                        <span className="text-[0.6rem] text-gray-400">{expandedActs[act._localId] ? "▲" : "▼"}</span>
                                      </>
                                    )}
                                  </div>
                                </div>

                                {/* AI Inline Diff View */}
                                {!act.isDeleted && aiState && aiChangeGroups && (
                                  <div className="mt-1 pl-7">
                                    <div className="border border-purple-200 rounded-lg p-3 bg-white text-sm leading-relaxed text-gray-700">
                                      {aiChangeGroups.map((g, gi) => {
                                        if (g.type === 'unchanged') return <span key={gi}>{g.text}</span>;
                                        const selected = aiState.selectedVersions[g.index] ?? 'ai';
                                        const isAiSelected = selected === 'ai';

                                        // 순수 삭제 (AI가 제거, 대체 없음): 가운데줄 표시
                                        if (g.ai === '') {
                                          return (
                                            <span
                                              key={gi}
                                              onClick={() => handleSelectActivityVersion(act._localId, g.index, isAiSelected ? 'original' : 'ai')}
                                              title={isAiSelected ? "클릭하면 복원됩니다" : "클릭하면 다시 삭제됩니다"}
                                              className={`cursor-pointer rounded px-[1px] transition-all select-none ${
                                                isAiSelected
                                                  ? 'line-through text-red-500 bg-red-50 hover:bg-red-100'
                                                  : 'text-gray-700 bg-green-50'
                                              }`}
                                            >
                                              {g.original}
                                            </span>
                                          );
                                        }

                                        // 변경 (교체): AI 버전 위 / 원본 아래 카드
                                        return (
                                          <span key={gi} className="inline-flex flex-col border border-gray-200 rounded-md mx-0.5 my-0.5 overflow-hidden align-bottom shadow-sm text-[0.82rem]">
                                            <span
                                              onClick={() => handleSelectActivityVersion(act._localId, g.index, 'ai')}
                                              title="AI 버전 선택"
                                              className={`px-1.5 py-0.5 cursor-pointer transition-colors leading-snug select-none ${
                                                isAiSelected ? 'bg-red-50 text-red-600 font-semibold' : 'bg-white text-red-300 hover:bg-red-50'
                                              }`}
                                            >
                                              {g.ai}
                                            </span>
                                            <span
                                              onClick={() => handleSelectActivityVersion(act._localId, g.index, 'original')}
                                              title="원본 선택"
                                              className={`px-1.5 py-0.5 cursor-pointer transition-colors leading-snug border-t border-gray-100 select-none ${
                                                !isAiSelected ? 'bg-green-50 text-green-600 font-semibold' : 'bg-white text-green-400 hover:bg-green-50'
                                              }`}
                                            >
                                              {g.original}
                                            </span>
                                          </span>
                                        );
                                      })}
                                    </div>
                                    <p className="text-[0.68rem] text-gray-400 mt-1">변경: 위(AI) / 아래(원본) 클릭 선택 &nbsp;·&nbsp; 삭제: 취소선 클릭으로 복원</p>
                                  </div>
                                )}

                                {/* Normal Expanded Textarea */}
                                {!act.isDeleted && !aiState && expandedActs[act._localId] && (
                                  <div className="flex gap-3 mt-2 pl-7">
                                    <div className="flex-1 relative">
                                      <textarea
                                        value={act['입력내용'] || ""}
                                        onChange={(e) => {
                                          handleContentChange(act._localId, e.target.value);
                                          e.target.style.height = 'auto';
                                          e.target.style.height = `${e.target.scrollHeight}px`;
                                        }}
                                        ref={(el) => {
                                          if (el) {
                                            el.style.height = 'auto';
                                            el.style.height = `${el.scrollHeight}px`;
                                          }
                                        }}
                                        className="w-full border border-gray-200 rounded-lg p-3 text-sm text-gray-600 focus:border-primary focus:ring-2 focus:ring-primary/10 outline-none resize-none transition-colors overflow-hidden leading-relaxed"
                                        rows={1}
                                        onClick={(e) => e.stopPropagation()}
                                      />
                                    </div>
                                    <div className="flex flex-col justify-end gap-3 pb-2 shrink-0">
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          navigator.clipboard.writeText(act['입력내용'] || "");
                                          const btn = e.currentTarget;
                                          btn.textContent = "✅";
                                          setTimeout(() => { btn.textContent = "📋"; }, 1200);
                                        }}
                                        className="text-gray-400 hover:text-primary transition-colors text-base"
                                        title="내용 복사"
                                      >📋</button>
                                      {savedRecentContent[act._localId] ? (
                                        <button
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            handleContentChange(act._localId, savedRecentContent[act._localId]);
                                            setSavedRecentContent(prev => { const n = { ...prev }; delete n[act._localId]; return n; });
                                          }}
                                          className="text-purple-400 hover:text-purple-600 transition-colors text-lg"
                                          title="최근 수정본으로 다시 되돌리기"
                                        >↪️</button>
                                      ) : isActivityModified(act) ? (
                                        <button
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            handleRestoreActivity(act);
                                          }}
                                          className="text-orange-500 hover:text-orange-700 transition-colors text-lg"
                                          title="서버 저장 기록 삭제하고 원본으로 되돌리기"
                                        >🔄</button>
                                      ) : null}
                                    </div>
                                  </div>
                                )}
                              </div>
                            )}
                          </Draggable>
                          );
                        })}
                      {provided.placeholder}
                    </div>
                  )}
                </Droppable>
              </DragDropContext>
              )}
              {currentStudentActivities.length === 0 && (
                <div className="text-center text-gray-500 mt-10 text-sm">현재 선택된 영역의 활동 내역이 없습니다.</div>
              )}
            </div>
          </section>

          {/* Assistant Section */}
          <section className="flex-[2] flex flex-col gap-5 overflow-hidden">
            {/* Preview Panel */}
            <div className={`glass-panel p-5 flex-1 flex flex-col min-h-0 ${aiBaseText ? "ring-2 ring-purple-300" : ""}`}>
              <div className="flex justify-between items-center mb-3 shrink-0">
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold">최종 미리보기</h3>
                  {isShortening && (
                    <span className="text-xs bg-purple-100 text-purple-700 font-bold px-2 py-0.5 rounded-full animate-pulse">✨ AI 요약 중...</span>
                  )}
                  {aiBaseText && !isShortening && (
                    <span className="text-xs bg-purple-100 text-purple-700 font-bold px-2 py-0.5 rounded-full">✨ AI 요약 비교</span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {aiBaseText && (
                    <button
                      onClick={() => { setAiBaseText(null); setRestoredChunks(new Set()); }}
                      className="text-xs font-semibold text-gray-500 bg-white border border-gray-200 px-2.5 py-1.5 rounded hover:bg-gray-50 transition-colors"
                    >
                      ↩️ 원본으로
                    </button>
                  )}
                  <button onClick={handleCopy} className="text-sm font-semibold bg-primary text-white px-3 py-1.5 rounded flex items-center gap-1 hover:bg-primary-hover transition-colors">
                    📋 복사
                  </button>
                </div>
              </div>

              {/* 로딩 중 */}
              {isShortening && (
                <div className="flex-1 flex flex-col items-center justify-center gap-3 text-purple-600">
                  <div className="w-8 h-8 border-4 border-purple-200 border-t-purple-600 rounded-full animate-spin" />
                  <p className="text-sm font-semibold">AI가 분량을 줄이고 있습니다...</p>
                  <p className="text-xs text-gray-400">잠시만 기다려 주세요</p>
                </div>
              )}

              {/* AI 비교 화면 */}
              {!isShortening && aiBaseText && aiDiff && aiDisplayText !== null && (
                <div className="flex flex-col gap-2 flex-1 min-h-0">
                  <div className="flex gap-3 flex-1 min-h-0">
                    {/* 원본 (삭제된 부분 빨간색) */}
                    <div className="flex-1 flex flex-col gap-1 min-h-0">
                      <div className="flex justify-between items-center text-xs text-gray-500 shrink-0">
                        <span className="font-semibold">원본</span>
                        <span className="font-mono">{getByteLength(combinedText)}B</span>
                      </div>
                      <div className="flex-1 border border-gray-200 rounded-lg p-3 bg-gray-50 text-[0.88rem] leading-relaxed overflow-y-auto">
                        {aiDiff.map((part: Diff.Change, i: number) => {
                          if (part.added) return null;
                          if (part.removed) {
                            const isRestored = restoredChunks.has(i);
                            return (
                              <span
                                key={i}
                                onClick={() => toggleChunkRestore(i)}
                                title={isRestored ? "클릭하면 다시 삭제됩니다" : "클릭하면 복원됩니다"}
                                className={`cursor-pointer rounded px-[1px] transition-all ${
                                  isRestored
                                    ? "bg-green-100 text-green-700 font-semibold"
                                    : "line-through text-red-500 bg-red-50 hover:bg-red-100"
                                }`}
                              >
                                {part.value}
                              </span>
                            );
                          }
                          return <span key={i}>{part.value}</span>;
                        })}
                      </div>
                      <p className="text-[0.7rem] text-gray-400 shrink-0">빨간 글자 클릭 → 복원 / 초록 글자 클릭 → 다시 삭제</p>
                    </div>

                    <div className="flex items-center justify-center text-gray-300 font-bold text-lg shrink-0">▶</div>

                    {/* AI 요약본 */}
                    <div className="flex-1 flex flex-col gap-1 min-h-0">
                      <div className="flex justify-between items-center text-xs text-purple-600 shrink-0">
                        <span className="font-semibold">AI 요약본</span>
                        <span className={`font-bold font-mono ${getByteLength(aiDisplayText) > targetBytes ? "text-red-500" : ""}`}>
                          {getByteLength(aiDisplayText)}B
                        </span>
                      </div>
                      <div className="flex-1 border border-purple-200 rounded-lg p-3 bg-purple-50/30 text-[0.88rem] leading-relaxed overflow-y-auto text-gray-800 whitespace-pre-wrap">
                        {aiDisplayText}
                      </div>
                      <p className="text-[0.7rem] text-purple-400 font-semibold shrink-0">
                        -{getByteLength(combinedText) - getByteLength(aiDisplayText)}B 절감
                      </p>
                    </div>
                  </div>

                  {/* 최종 반영 버튼 */}
                  <div className="shrink-0 flex justify-end">
                    <button
                      onClick={() => {
                        if (aiDisplayText !== null) {
                          setFinalText(aiDisplayText);
                          setAiBaseText(null);
                          setRestoredChunks(new Set());
                        }
                      }}
                      className="text-sm font-bold bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded-lg flex items-center gap-1.5 transition-colors shadow-sm"
                    >
                      ✅ 최종 반영
                    </button>
                  </div>
                </div>
              )}

              {/* 기본 미리보기 (AI 없을 때) */}
              {!isShortening && !aiBaseText && (
                <div className="flex flex-col flex-1 min-h-0 gap-1">
                  {finalText && (
                    <div className="flex items-center justify-between text-xs shrink-0 bg-purple-50 border border-purple-200 rounded-lg px-3 py-1.5">
                      <span className="text-purple-700 font-semibold">✅ AI 요약본이 최종 반영되었습니다</span>
                      <button
                        onClick={() => setFinalText(null)}
                        className="text-gray-400 hover:text-gray-600 underline"
                      >
                        ↩️ 원본으로 되돌리기
                      </button>
                    </div>
                  )}
                  <textarea
                    readOnly
                    value={displayText}
                    className={`flex-1 w-full border rounded-lg p-3 text-[0.95rem] text-gray-800 resize-none outline-none leading-relaxed ${finalText ? "border-purple-200 bg-purple-50/30" : "border-gray-200 bg-gray-50"}`}
                    placeholder="최종 편집된 내용이 여기에 표시됩니다."
                  />
                </div>
              )}
            </div>

            {/* Recommendations */}
            <div className={`glass-panel p-5 flex flex-col shrink-0 transition-all duration-300 ${showRecommendations ? "h-[280px]" : "h-auto"}`}>
              <div className="flex justify-between items-center shrink-0" style={{ marginBottom: showRecommendations ? '0.75rem' : 0 }}>
                <div className="flex items-center gap-2">
                  <button
                    className="flex items-center gap-2 cursor-pointer group"
                    onClick={() => setShowRecommendations(prev => !prev)}
                  >
                    <h3 className="font-semibold text-[1.1rem] group-hover:text-primary transition-colors">창체 문구</h3>
                    <span className="text-[0.6rem] text-gray-400">{showRecommendations ? "▲" : "▼"}</span>
                  </button>
                  <button
                    onClick={handleRandomRecommendation}
                    title="랜덤으로 1~3개 추천 문구 자동 배정"
                    className="flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full border border-indigo-200 bg-indigo-50 text-indigo-600 hover:bg-indigo-100 hover:border-indigo-400 transition-colors"
                  >
                    🎲 랜덤 배정
                  </button>
                </div>
                {showRecommendations && (
                  <div className="flex gap-1">
                    <button 
                      onClick={() => setRecFilter("전체")}
                      className={`px-2 py-0.5 rounded-full border text-xs font-medium transition-colors ${recFilter === "전체" ? "border-primary bg-primary text-white" : "border-gray-200 bg-white text-gray-500 hover:border-primary hover:text-primary"}`}
                    >
                      전체
                    </button>
                    <button 
                      onClick={() => setRecFilter("추천")}
                      className={`px-2 py-0.5 rounded-full border text-xs font-medium transition-colors ${recFilter === "추천" ? "border-primary bg-primary text-white" : "border-gray-200 bg-white text-gray-500 hover:border-primary hover:text-primary"}`}
                    >
                      추천
                    </button>
                  </div>
                )}
              </div>
              {showRecommendations && <div className="flex-1 overflow-y-auto pr-2 flex flex-col gap-3">
                {groupedRecommendations.size > 0 ? 
                  Array.from<[string, any[]]>(groupedRecommendations.entries()).map(([title, recs], groupIdx) => {
                    const activeIdx = expandedRecs[title];
                    const isExpanded = activeIdx !== undefined && activeIdx !== null;
                    const isAlreadyAdded = activeStudentActivities.some(a => a['활동명'] === title);
                    
                    return (
                      <div key={groupIdx} className={`bg-white p-3 rounded-lg border transition-all flex flex-col gap-1 ${isAlreadyAdded ? "border-green-200 bg-green-50/40" : "border-gray-100 hover:shadow-sm"}`}>
                        <div className="flex flex-col gap-2">
                          <div 
                            className="flex justify-between items-start cursor-pointer group"
                            onClick={() => toggleRec(title, activeIdx ?? 0)}
                          >
                            <div className="flex items-center gap-1.5 flex-1 pr-2">
                              <span className={`font-semibold text-[0.9rem] leading-tight transition-colors ${isAlreadyAdded ? "text-green-700" : "text-gray-800 group-hover:text-primary"}`}>
                                {title}
                              </span>
                              {isAlreadyAdded && (
                                <span className="text-[0.65rem] bg-green-100 text-green-600 font-bold px-1.5 py-0.5 rounded-full shrink-0">추가됨</span>
                              )}
                            </div>
                            <span className="text-[0.6rem] text-gray-400 mt-1">{isExpanded ? "▲" : "▼"}</span>
                          </div>
                          
                          <div className="flex flex-wrap gap-2">
                            {recs.map((rec: any, idx: number) => {
                              const isActive = isExpanded && activeIdx === idx;
                              const useCount = getClassUseCount(title, rec['활동내용'] || "");
                              const useStyle = getUseCountStyle(useCount);
                              return (
                                <div key={idx} className={`flex flex-col gap-0.5`}>
                                  <div className={`flex items-center rounded overflow-hidden transition-all border ${isAlreadyAdded ? (useCount >= 3 ? "border-red-200" : useCount === 2 ? "border-orange-200" : useCount === 1 ? "border-yellow-200" : "border-green-200") : isActive ? "border-primary shadow-sm" : useCount >= 3 ? "border-red-200" : useCount === 2 ? "border-orange-200" : useCount === 1 ? "border-yellow-200" : "border-gray-200"}`}>
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        if (!isAlreadyAdded) setExpandedRecs(prev => ({ ...prev, [title]: isActive ? null : idx }));
                                      }}
                                      disabled={isAlreadyAdded}
                                      className={`text-[0.7rem] font-mono px-2 py-0.5 transition-colors ${isAlreadyAdded ? `${useStyle.btn} opacity-70 cursor-not-allowed` : isActive ? "bg-primary text-white" : useStyle.btn}`}
                                    >
                                      {getByteLength(rec['활동내용'] || "")} B
                                    </button>
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleAddRecommendation(title, rec['활동내용']);
                                      }}
                                      disabled={isAlreadyAdded}
                                      title={isAlreadyAdded ? "이미 추가된 활동입니다" : "바로 에디터에 추가"}
                                      className={`text-[0.8rem] font-bold px-2 py-0.5 transition-colors border-l ${isAlreadyAdded ? "bg-gray-50 border-green-200 text-gray-300 cursor-not-allowed" : isActive ? "bg-primary border-primary-hover text-white hover:bg-primary-hover" : "bg-white border-gray-200 text-primary hover:bg-primary hover:text-white"}`}
                                    >
                                      {isAlreadyAdded ? "✓" : "+"}
                                    </button>
                                  </div>
                                  {useStyle.badge && (
                                    <span className={`text-[0.6rem] font-bold text-center leading-none px-1 py-0.5 rounded ${useCount >= 3 ? "text-red-500" : useCount === 2 ? "text-orange-500" : "text-yellow-600"}`}>
                                      {useStyle.badge}
                                    </span>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>

                        {isExpanded && recs[activeIdx] && !isAlreadyAdded && (
                          <div className="mt-2 flex flex-col gap-2 border-t border-gray-50 pt-2">
                            <p className="text-[0.85rem] text-gray-600 leading-relaxed bg-gray-50 p-2 rounded">
                              {recs[activeIdx]['활동내용']}
                            </p>
                            <div className="flex justify-between items-center mt-1">
                              <span className="text-xs text-gray-400 font-mono">
                                {getByteLength(recs[activeIdx]['활동내용'] || "")} Byte
                              </span>
                              <button 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleAddRecommendation(title, recs[activeIdx]['활동내용']);
                                }}
                                className="px-3 py-1 bg-primary-light text-primary text-xs font-bold rounded hover:bg-primary hover:text-white transition-colors"
                              >
                                추가
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  }) : (
                  <div className="text-center text-gray-500 mt-5 text-sm">현재 영역의 추천 문구가 없습니다.</div>
                )}
              </div>}
            </div>
          </section>
        </div>
      </main>

      {/* Upload Modal */}
      {showUploadModal && (
        <UploadModal
          onClose={() => setShowUploadModal(false)}
          onSuccess={() => {
            localStorage.removeItem('recordAssistant_activities');
            setTimeout(() => {
              setShowUploadModal(false);
              fetchData();
            }, 2000);
          }}
        />
      )}

      {/* Global Order Modal */}
      {showOrderModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden border border-gray-100">
            <div className="p-5 border-b border-gray-200 flex justify-between items-center bg-gray-50/80">
              <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2">
                <span className="bg-primary text-white text-sm px-2 py-1 rounded">2학년 1반</span> 전체 활동 순서 설정
              </h2>
              <button onClick={() => setShowOrderModal(false)} className="text-gray-400 hover:text-gray-800 font-bold text-2xl transition-colors">×</button>
            </div>
            
            <DragDropContext onDragEnd={onDragEndModal}>
              <div className="p-5 overflow-y-auto flex-1 bg-gray-50 flex gap-6">
                {/* 자율활동 순서 */}
                <div className="flex-1 bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden flex flex-col">
                  <div className="bg-purple-100/50 text-purple-800 font-bold p-3 text-center border-b border-purple-200/50">
                    자율활동
                  </div>
                  <Droppable droppableId="modal-auto">
                    {(provided) => (
                      <div className="p-2 flex-1 overflow-y-auto" {...provided.droppableProps} ref={provided.innerRef}>
                        {classAutoActs.length === 0 ? <p className="text-center text-sm text-gray-400 py-4">활동 없음</p> : null}
                        {classAutoActs.map((act, idx) => (
                          <Draggable key={`auto-${act}`} draggableId={`auto-${act}`} index={idx}>
                            {(provided) => (
                              <div
                                ref={provided.innerRef}
                                {...provided.draggableProps}
                                className="flex items-center p-2 mb-2 bg-gray-50 rounded border border-gray-100 hover:border-gray-300 hover:shadow-sm transition-all"
                              >
                                <div {...provided.dragHandleProps} className="cursor-grab text-gray-400 hover:text-gray-600 transition-colors px-1 mr-1">⋮⋮</div>
                                <span className="text-sm font-medium text-gray-700 truncate flex-1">{act}</span>
                              </div>
                            )}
                          </Draggable>
                        ))}
                        {provided.placeholder}
                      </div>
                    )}
                  </Droppable>
                </div>

                {/* 진로활동 순서 */}
                <div className="flex-1 bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden flex flex-col">
                  <div className="bg-blue-100/50 text-blue-800 font-bold p-3 text-center border-b border-blue-200/50">
                    진로활동
                  </div>
                  <Droppable droppableId="modal-career">
                    {(provided) => (
                      <div className="p-2 flex-1 overflow-y-auto" {...provided.droppableProps} ref={provided.innerRef}>
                        {classCareerActs.length === 0 ? <p className="text-center text-sm text-gray-400 py-4">활동 없음</p> : null}
                        {classCareerActs.map((act, idx) => (
                          <Draggable key={`career-${act}`} draggableId={`career-${act}`} index={idx}>
                            {(provided) => (
                              <div
                                ref={provided.innerRef}
                                {...provided.draggableProps}
                                className="flex items-center p-2 mb-2 bg-gray-50 rounded border border-gray-100 hover:border-gray-300 hover:shadow-sm transition-all"
                              >
                                <div {...provided.dragHandleProps} className="cursor-grab text-gray-400 hover:text-gray-600 transition-colors px-1 mr-1">⋮⋮</div>
                                <span className="text-sm font-medium text-gray-700 truncate flex-1">{act}</span>
                              </div>
                            )}
                          </Draggable>
                        ))}
                        {provided.placeholder}
                      </div>
                    )}
                  </Droppable>
                </div>
              </div>
            </DragDropContext>

            <div className="p-4 border-t border-gray-200 flex justify-end gap-3 bg-white">
              <button onClick={() => setShowOrderModal(false)} className="px-4 py-2 rounded font-medium text-gray-600 hover:bg-gray-100">취소</button>
              <button onClick={handleApplyGlobalOrder} className="px-6 py-2 rounded font-bold text-white bg-primary hover:bg-primary-hover shadow-md">일괄 적용</button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
