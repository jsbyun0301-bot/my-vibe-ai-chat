'use client';

import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, UIMessage } from 'ai';
import { useEffect, useMemo, useRef, useState } from 'react';

const QUICK_REPLIES = ['안녕 삐약이!', '오늘 뭐해?', '농담 하나 해줘', '기분이 안 좋아...'];
const STORAGE_KEY = 'vibe-simsimi-chat';
const LIKES_KEY = 'vibe-simsimi-likes';
const THEME_KEY = 'vibe-simsimi-theme';
const MOOD_KEY = 'vibe-simsimi-mood';
const RESET_COUNT_KEY = 'vibe-simsimi-resets';
const LAST_VISIT_KEY = 'vibe-simsimi-lastvisit';
const HIDDEN_FORM_KEY = 'vibe-simsimi-hidden';
const INITIAL_MOOD = 60;
const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;

type HiddenFormType = 'dark' | 'angel' | 'zombie' | 'phoenix';

const HIDDEN_FORMS: Record<HiddenFormType, { image: string; name: string; desc: string; bannerText: string }> = {
  dark:    { image: '/dark.png',    name: '흑화 삐약이',   desc: '어둠에 물든 삐약이...',       bannerText: '어둠의 힘이 깨어났다...' },
  angel:   { image: '/angel.png',   name: '천사 삐약이',   desc: '사랑으로 빛나는 삐약이',     bannerText: '사랑의 빛이 감싸안았다!' },
  zombie:  { image: '/zombie.png',  name: '좀비 삐약이',   desc: '버려진 삐약이의 귀환...',     bannerText: '...드디어 돌아왔구나.' },
  phoenix: { image: '/phoenix.png', name: '불사조 삐약이', desc: '재에서 다시 태어난 전설',     bannerText: '불사조가 다시 날아오른다!' },
};

const NEGATIVE_WORDS = [
  '싫', '바보', '멍청', '짜증', '화나', '미워', '최악', '쓰레기', '나빠', '나쁜',
  '우울', '답답', '별로', '꺼져', '죽어', '귀찮', '못생', '혐오', '지겨', '뭐래',
  '닥쳐', '망해', '더러',
];
const POSITIVE_WORDS = [
  '좋아', '좋다', '사랑', '귀여', '예쁘', '최고', '고마워', '고맙', '행복', '잘했',
  '똑똑', '착해', '멋져', '훌륭', '재밌', '재미있', '감사', '대박', '짱', '굿',
  '최고야', '기뻐',
];

function computeMoodDelta(text: string): number {
  const lower = text.toLowerCase();
  let delta = 0;
  let matched = false;
  for (const w of NEGATIVE_WORDS) {
    if (lower.includes(w)) {
      delta -= 10;
      matched = true;
    }
  }
  for (const w of POSITIVE_WORDS) {
    if (lower.includes(w)) {
      delta += 5;
      matched = true;
    }
  }
  if (!matched) delta = 1;
  return delta;
}

type Stage = {
  level: number;
  emoji: string;
  headerEmoji: string;
  name: string;
  minXp: number;
  desc: string;
  image?: string;
};

const EVOLUTIONS: Stage[] = [
  { level: 1, emoji: '🥚',   headerEmoji: '🥚', name: '알',       minXp: 0,   desc: '뭔가 움직이는 것 같아...', image: '/1.png' },
  { level: 2, emoji: '🐣',   headerEmoji: '🐣', name: '부화',     minXp: 10,  desc: '삐약! 방금 태어났어!', image: '/2.png' },
  { level: 3, emoji: '🐤',   headerEmoji: '🐤', name: '병아리',   minXp: 80,  desc: '삐약삐약~ 잘 부탁해!', image: '/3.png' },
  { level: 4, emoji: '🐥',   headerEmoji: '🐥', name: '큰병아리', minXp: 200, desc: '점점 자라고 있어!', image: '/4.png' },
  { level: 5, emoji: '🐔',   headerEmoji: '🐔', name: '닭',       minXp: 450, desc: '꼬끼오! 어른이 됐어!', image: '/5.png' },
  { level: 6, emoji: '✨🐔', headerEmoji: '🐔', name: '황금닭',   minXp: 900, desc: '전설의 황금닭이 나타났다!', image: '/6.png' },
];

function getStage(xp: number): Stage {
  let stage = EVOLUTIONS[0];
  for (const e of EVOLUTIONS) if (xp >= e.minXp) stage = e;
  return stage;
}

type ChatState = {
  level: number;
  stageName: string;
  mood: number;
  affection: number;
  closeness: number;
  hiddenForm: string | null;
};

export default function Chat() {
  const chatStateRef = useRef<ChatState>({
    level: 1,
    stageName: '알',
    mood: 0,
    affection: 0,
    closeness: 0,
    hiddenForm: null,
  });

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: '/api/chat',
        body: () => ({ chatState: chatStateRef.current }),
      }),
    [],
  );

  const { messages, sendMessage, setMessages, status } = useChat({ transport });
  const [input, setInput] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [timestamps, setTimestamps] = useState<Record<string, number>>({});
  const [likes, setLikes] = useState<Record<string, boolean>>({});
  const [isDark, setIsDark] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [levelUpStage, setLevelUpStage] = useState<Stage | null>(null);
  const [evolutionData, setEvolutionData] = useState<{
    from: { emoji: string; image?: string };
    to: { emoji: string; image?: string; name: string };
    isHidden: boolean;
  } | null>(null);
  const [moodScore, setMoodScore] = useState(INITIAL_MOOD);
  const [hiddenForm, setHiddenForm] = useState<HiddenFormType | null>(null);
  const [resetCount, setResetCount] = useState(0);
  const prevLevelRef = useRef<number>(1);
  const evoTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const processedUserCountRef = useRef<number>(0);
  const firstMoodRunRef = useRef<boolean>(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showScrollBtn, setShowScrollBtn] = useState(false);

  const isLoading = status === 'submitted' || status === 'streaming';

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as { messages: UIMessage[]; timestamps: Record<string, number> };
        if (parsed.messages?.length) setMessages(parsed.messages);
        if (parsed.timestamps) setTimestamps(parsed.timestamps);
      }
      const savedLikes = localStorage.getItem(LIKES_KEY);
      if (savedLikes) setLikes(JSON.parse(savedLikes));
      const savedTheme = localStorage.getItem(THEME_KEY);
      if (savedTheme === 'dark') setIsDark(true);
      const savedMood = localStorage.getItem(MOOD_KEY);
      if (savedMood !== null) {
        const n = Number(savedMood);
        if (!Number.isNaN(n)) setMoodScore(n);
      }
      const savedHidden = localStorage.getItem(HIDDEN_FORM_KEY);
      if (savedHidden && savedHidden in HIDDEN_FORMS) {
        setHiddenForm(savedHidden as HiddenFormType);
      }
      const savedResets = localStorage.getItem(RESET_COUNT_KEY);
      if (savedResets) setResetCount(Number(savedResets) || 0);

      // 좀비 체크: 마지막 방문 후 3일 이상 경과 + 레벨 3 이상 + 히든폼 미보유
      const lastVisit = localStorage.getItem(LAST_VISIT_KEY);
      if (lastVisit && !savedHidden) {
        const elapsed = Date.now() - Number(lastVisit);
        const savedChat = localStorage.getItem(STORAGE_KEY);
        const msgCount = savedChat ? (JSON.parse(savedChat).messages?.length ?? 0) : 0;
        if (elapsed >= THREE_DAYS_MS && msgCount >= 10) {
          setHiddenForm('zombie');
          localStorage.setItem(HIDDEN_FORM_KEY, 'zombie');
        }
      }
      // 방문 시각 갱신
      localStorage.setItem(LAST_VISIT_KEY, String(Date.now()));
    } catch {}
    setHydrated(true);
  }, [setMessages]);

  // 새 사용자 메시지 → 감정 분석 → 기분 업데이트
  useEffect(() => {
    if (!hydrated) return;
    const userMsgs = messages.filter(m => m.role === 'user');
    if (firstMoodRunRef.current) {
      // hydration 직후 복원된 메시지는 이미 반영된 것으로 간주 (재처리 금지)
      firstMoodRunRef.current = false;
      processedUserCountRef.current = userMsgs.length;
      return;
    }
    if (userMsgs.length > processedUserCountRef.current) {
      const newOnes = userMsgs.slice(processedUserCountRef.current);
      let delta = 0;
      for (const m of newOnes) {
        const text = m.parts
          .map(p => (p.type === 'text' ? p.text : ''))
          .join('');
        delta += computeMoodDelta(text);
      }
      if (delta !== 0) {
        setMoodScore(v => Math.max(0, Math.min(100, v + delta)));
      }
      processedUserCountRef.current = userMsgs.length;
    }
  }, [messages, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(MOOD_KEY, String(moodScore));
    } catch {}
  }, [moodScore, hydrated]);

  useEffect(() => {
    setTimestamps(prev => {
      const next = { ...prev };
      let changed = false;
      for (const m of messages) {
        if (!next[m.id]) {
          next[m.id] = Date.now();
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [messages]);

  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ messages, timestamps }));
    } catch {}
  }, [messages, timestamps, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(LIKES_KEY, JSON.stringify(likes));
    } catch {}
  }, [likes, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(THEME_KEY, isDark ? 'dark' : 'light');
    } catch {}
  }, [isDark, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    try {
      if (hiddenForm) localStorage.setItem(HIDDEN_FORM_KEY, hiddenForm);
      else localStorage.removeItem(HIDDEN_FORM_KEY);
    } catch {}
    // 히든폼별 테마 자동 전환 (최초 1회)
    if (hiddenForm === 'dark' || hiddenForm === 'zombie') {
      setIsDark(true);
    } else if (hiddenForm === 'angel' || hiddenForm === 'phoenix') {
      setIsDark(false);
    }
  }, [hiddenForm, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(RESET_COUNT_KEY, String(resetCount));
    } catch {}
  }, [resetCount, hydrated]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, isLoading]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const handleScroll = () => {
      const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      setShowScrollBtn(distFromBottom > 150);
    };
    el.addEventListener('scroll', handleScroll);
    return () => el.removeEventListener('scroll', handleScroll);
  }, []);

  const { stage, nextStage, xp, xpProgress, xpToNext, stats } = useMemo(() => {
    const userMessages = messages.filter(m => m.role === 'user').length;
    const botMessages = messages.filter(m => m.role === 'assistant').length;
    const likeCount = Object.values(likes).filter(Boolean).length;
    const xp = userMessages * 10 + likeCount * 25;
    const stage = getStage(xp);
    const idx = EVOLUTIONS.indexOf(stage);
    const nextStage: Stage | null = EVOLUTIONS[idx + 1] ?? null;
    const xpProgress = nextStage
      ? Math.min(100, ((xp - stage.minXp) / (nextStage.minXp - stage.minXp)) * 100)
      : 100;
    const xpToNext = nextStage ? nextStage.minXp - xp : 0;

    const closeness = Math.min(100, userMessages * 5);
    const affection = Math.min(100, likeCount * 15);
    const mood = moodScore;

    return {
      stage,
      nextStage,
      xp,
      xpProgress,
      xpToNext,
      stats: { closeness, affection, mood, userMessages, botMessages, likeCount },
    };
  }, [messages, likes, moodScore]);

  const displayStage = useMemo(() => {
    if (hiddenForm && HIDDEN_FORMS[hiddenForm]) {
      const h = HIDDEN_FORMS[hiddenForm];
      return { ...stage, name: h.name, desc: h.desc, image: h.image };
    }
    return stage;
  }, [stage, hiddenForm]);

  useEffect(() => {
    chatStateRef.current = {
      level: stage.level,
      stageName: displayStage.name,
      mood: stats.mood,
      affection: stats.affection,
      closeness: stats.closeness,
      hiddenForm,
    };
  }, [stage, displayStage, stats, hiddenForm]);

  useEffect(() => {
    if (!hydrated) {
      prevLevelRef.current = stage.level;
      return;
    }
    if (stage.level > prevLevelRef.current) {
      const fromStage = EVOLUTIONS.find(e => e.level === prevLevelRef.current) || EVOLUTIONS[0];
      let toData = { emoji: stage.emoji, image: stage.image, name: stage.name };
      let isHidden = false;

      // Lv5 도달 시 히든폼 조건 체크
      if (stage.level >= 5 && prevLevelRef.current < 5 && !hiddenForm) {
        const likeCount = Object.values(likes).filter(Boolean).length;
        let newHidden: HiddenFormType | null = null;
        if (resetCount >= 2) {
          newHidden = 'phoenix';
        } else if (moodScore >= 90 && likeCount >= 10) {
          newHidden = 'angel';
        } else if (moodScore < 30) {
          newHidden = 'dark';
        }
        if (newHidden) {
          setHiddenForm(newHidden);
          const h = HIDDEN_FORMS[newHidden];
          toData = { emoji: '', image: h.image, name: h.name };
          isHidden = true;
        }
      }

      // 기존 타이머 정리
      evoTimersRef.current.forEach(t => clearTimeout(t));

      // 진화 애니메이션 시작
      setEvolutionData({
        from: { emoji: fromStage.emoji, image: fromStage.image },
        to: toData,
        isHidden,
      });
      prevLevelRef.current = stage.level;

      // 애니메이션 종료 후 배너 표시 (ref로 관리 → cleanup에 영향받지 않음)
      const t1 = setTimeout(() => {
        setEvolutionData(null);
        setLevelUpStage({ ...stage, ...toData });
      }, 5000);
      const t2 = setTimeout(() => setLevelUpStage(null), 8000);
      evoTimersRef.current = [t1, t2];
    }
    prevLevelRef.current = stage.level;
  }, [stage, hydrated, hiddenForm, likes, moodScore, resetCount]);

  const handleSend = (text: string) => {
    if (!text.trim() || isLoading) return;

    // 치트 키 처리
    const cheat = text.trim();
    if (cheat.startsWith('히든폼')) {
      const num = cheat.replace('히든폼', '').trim();
      const cheatMap: Record<string, HiddenFormType> = { '1': 'dark', '2': 'angel', '3': 'zombie', '4': 'phoenix' };
      const form = cheatMap[num];
      if (form) {
        const h = HIDDEN_FORMS[form];
        setEvolutionData({
          from: { emoji: stage.emoji, image: stage.image },
          to: { emoji: '', image: h.image, name: h.name },
          isHidden: true,
        });
        setTimeout(() => {
          prevLevelRef.current = stage.level;
          setEvolutionData(null);
          setHiddenForm(form);
        }, 5000);
        setInput('');
        return;
      }
    }
    if (cheat === '히든폼 해제') {
      setHiddenForm(null);
      setInput('');
      return;
    }
    if (cheat.startsWith('레벨')) {
      const lvl = Number(cheat.replace('레벨', '').trim());
      const target = EVOLUTIONS.find(e => e.level === lvl);
      if (target) {
        const needXp = target.minXp;
        const dummyCount = Math.ceil(needXp / 10);
        const dummyMessages = Array.from({ length: dummyCount }, (_, i) => ({
          id: `cheat-${Date.now()}-${i}`,
          role: 'user' as const,
          parts: [{ type: 'text' as const, text: '.' }],
        }));
        setEvolutionData({
          from: { emoji: stage.emoji, image: stage.image },
          to: { emoji: target.emoji, image: target.image, name: target.name },
          isHidden: false,
        });
        setTimeout(() => {
          prevLevelRef.current = target.level;
          setEvolutionData(null);
          setMessages(dummyCount > 0 ? dummyMessages : []);
          setHiddenForm(null);
        }, 5000);
        setInput('');
        return;
      }
    }

    sendMessage({ text });
    setInput('');
  };

  const handleClear = () => {
    if (!confirm('대화 내역을 모두 지울까요? 삐약이도 알로 돌아가요!')) return;
    setMessages([]);
    setTimestamps({});
    setLikes({});
    setMoodScore(INITIAL_MOOD);
    setResetCount(v => v + 1);
    setHiddenForm(null);
    prevLevelRef.current = 1;
    processedUserCountRef.current = 0;
  };

  const toggleLike = (id: string) => {
    setLikes(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const handleCopy = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1500);
    } catch {}
  };

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    const h = d.getHours();
    const m = d.getMinutes();
    const ampm = h < 12 ? '오전' : '오후';
    const hh = h % 12 || 12;
    return `${ampm} ${hh}:${m.toString().padStart(2, '0')}`;
  };

  const theme = isDark
    ? {
        page: 'bg-gradient-to-br from-gray-900 via-gray-800 to-yellow-950',
        frame: 'bg-gray-800/90 border-yellow-600 backdrop-blur',
        sidebar: 'bg-gray-800/90 border-yellow-600 backdrop-blur',
        sidebarText: 'text-gray-100',
        sidebarSub: 'text-gray-400',
        divider: 'border-gray-700',
        header: 'bg-yellow-600',
        headerText: 'text-gray-900',
        headerSub: 'text-yellow-900',
        body: 'bg-gray-800/70',
        empty: 'text-gray-500',
        userBubble: 'bg-yellow-500/90 text-gray-900',
        botBubble: 'bg-gray-700/80 text-gray-100 border-gray-600',
        botAvatarBg: 'bg-yellow-500',
        timeText: 'text-gray-500',
        inputBar: 'bg-gray-800 border-gray-700',
        inputField: 'bg-gray-700 text-gray-100 placeholder:text-gray-500',
        sendBtn: 'bg-yellow-500 hover:bg-yellow-400 text-gray-900',
        iconBtn: 'text-gray-900 hover:bg-yellow-500',
        quickChip: 'bg-gray-700 hover:bg-gray-600 text-gray-200 border-gray-600',
        tamaScreen: 'bg-gradient-to-b from-yellow-900/40 to-gray-900/60 border-yellow-700',
        statTrack: 'bg-gray-700',
        xpTrack: 'bg-gray-900',
        xpFill: 'bg-gradient-to-r from-yellow-400 to-amber-300',
        levelBadge: 'bg-yellow-500 text-gray-900',
      }
    : {
        page: 'bg-gradient-to-br from-yellow-50 via-amber-50 to-orange-50',
        frame: 'bg-white/90 border-yellow-300 backdrop-blur',
        sidebar: 'bg-white/90 border-yellow-300 backdrop-blur',
        sidebarText: 'text-gray-800',
        sidebarSub: 'text-gray-500',
        divider: 'border-yellow-100',
        header: 'bg-yellow-300',
        headerText: 'text-gray-800',
        headerSub: 'text-yellow-800',
        body: 'bg-yellow-50/70',
        empty: 'text-gray-400',
        userBubble: 'bg-yellow-400/90 text-gray-900',
        botBubble: 'bg-white/80 text-gray-800 border-yellow-100',
        botAvatarBg: 'bg-yellow-300',
        timeText: 'text-gray-400',
        inputBar: 'bg-white border-yellow-100',
        inputField: 'bg-yellow-50 text-gray-800 placeholder:text-gray-400',
        sendBtn: 'bg-yellow-400 hover:bg-yellow-500 text-white',
        iconBtn: 'text-gray-800 hover:bg-yellow-400',
        quickChip: 'bg-white hover:bg-yellow-100 text-gray-700 border-yellow-200',
        tamaScreen: 'bg-gradient-to-b from-yellow-100 to-amber-50 border-yellow-300',
        statTrack: 'bg-yellow-100',
        xpTrack: 'bg-yellow-100',
        xpFill: 'bg-gradient-to-r from-yellow-400 to-amber-500',
        levelBadge: 'bg-yellow-500 text-white',
      };

  const CharIcon = ({ size = 'md', className = '' }: { size?: 'sm' | 'md' | 'lg' | 'xl'; className?: string }) => {
    const sizeMap = { sm: 'w-8 h-8', md: 'w-11 h-11', lg: 'w-24 h-24', xl: 'w-32 h-32 md:w-40 md:h-40' };
    const textMap = { sm: 'text-lg', md: 'text-2xl', lg: 'text-5xl', xl: 'text-6xl md:text-8xl' };
    if (displayStage.image) {
      const scaleMap = { sm: 'scale-[3.0]', md: 'scale-[2.5]', lg: 'scale-[1.9]', xl: 'scale-[1.5]' };
      return <img src={displayStage.image} alt={displayStage.name} className={`${sizeMap[size]} object-contain ${scaleMap[size]} ${className}`} />;
    }
    return <span className={`${textMap[size]} ${className}`}>{displayStage.emoji}</span>;
  };

  const StatBar = ({ label, value, icon }: { label: string; value: number; icon: string }) => (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className={`text-xs ${theme.sidebarText}`}>
          {icon} {label}
        </span>
        <span className={`text-[10px] font-mono ${theme.sidebarSub}`}>{value}/100</span>
      </div>
      <div className={`h-2 ${theme.statTrack} rounded-full overflow-hidden`}>
        <div
          className={`h-full ${theme.xpFill} transition-all duration-500`}
          style={{ width: `${value}%` }}
        />
      </div>
    </div>
  );

  return (
    <div className={`min-h-screen ${theme.page} flex items-center justify-center p-4 md:p-8 transition-colors`}>
      {/* 진화 애니메이션 오버레이 (전체 화면) */}
      {evolutionData && (() => {
        const colorTheme = evolutionData.isHidden
          ? (evolutionData.to.name.includes('흑화') ? { flash: 'bg-purple-500/50', ring: 'border-purple-400/60', text: 'text-purple-300' }
            : evolutionData.to.name.includes('천사') ? { flash: 'bg-sky-200/60', ring: 'border-sky-300/60', text: 'text-sky-200' }
            : evolutionData.to.name.includes('좀비') ? { flash: 'bg-emerald-500/40', ring: 'border-emerald-400/50', text: 'text-emerald-300' }
            : { flash: 'bg-amber-500/45', ring: 'border-amber-400/50', text: 'text-amber-200' })
          : { flash: 'bg-white', ring: 'border-yellow-200', text: 'text-yellow-300' };

        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 animate-evo-backdrop">
            {/* 확장 링 이펙트 */}
            <div className={`absolute w-16 h-16 rounded-full border-2 ${colorTheme.ring} animate-evo-ring-1 pointer-events-none opacity-60`} />
            <div className={`absolute w-16 h-16 rounded-full border-2 ${colorTheme.ring} animate-evo-ring-2 pointer-events-none opacity-40`} />
            <div className={`absolute w-16 h-16 rounded-full border ${colorTheme.ring} animate-evo-ring-3 pointer-events-none opacity-30`} />

            {/* 이전 캐릭터 - 빛나다가 사라짐 */}
            <div className="absolute animate-evo-old">
              {evolutionData.from.image
                ? <img src={evolutionData.from.image} alt="" className="w-64 h-64 md:w-[22rem] md:h-[22rem] object-contain" />
                : <span className="text-7xl md:text-8xl">{evolutionData.from.emoji}</span>
              }
            </div>

            {/* 다중 플래시 */}
            <div className={`absolute inset-0 ${colorTheme.flash} animate-evo-flash-1 pointer-events-none`} />
            <div className={`absolute inset-0 ${colorTheme.flash} animate-evo-flash-2 pointer-events-none`} />

            {/* 화면 쉐이크 컨테이너 */}
            <div className="absolute animate-evo-shake">
              {/* 새 캐릭터 - 빛 속에서 등장 */}
              <div className="animate-evo-new">
                {evolutionData.to.image
                  ? <img src={evolutionData.to.image} alt="" className="w-72 h-72 md:w-96 md:h-96 object-contain drop-shadow-2xl" />
                  : <span className="text-8xl md:text-9xl drop-shadow-2xl">{evolutionData.to.emoji}</span>
                }
              </div>
            </div>

            {/* 회전 파티클 */}
            <div className="absolute animate-evo-sparkles pointer-events-none">
              <div className="animate-evo-orbit-1">
                <span className="absolute text-3xl" style={{ top: '-80px', left: '-10px' }}>✨</span>
                <span className="absolute text-2xl" style={{ bottom: '-70px', right: '-10px' }}>⭐</span>
              </div>
              <div className="animate-evo-orbit-2">
                <span className="absolute text-2xl" style={{ top: '-60px', right: '-70px' }}>💫</span>
                <span className="absolute text-3xl" style={{ bottom: '-50px', left: '-60px' }}>✨</span>
              </div>
              <span className="absolute -top-24 left-0 text-xl animate-float-1">⭐</span>
              <span className="absolute top-24 right-4 text-2xl animate-float-2">✨</span>
              <span className="absolute -left-20 top-4 text-xl animate-float-3">💫</span>
              <span className="absolute right-[-80px] -top-8 text-2xl animate-float-1">⭐</span>
            </div>

            {/* 이름 표시 */}
            <div className={`absolute bottom-[22%] animate-evo-name text-center ${colorTheme.text}`}>
              <p className="text-xs font-bold tracking-widest opacity-80">
                {evolutionData.isHidden ? '??? HIDDEN FORM ???' : 'EVOLUTION'}
              </p>
              <p className="text-2xl md:text-3xl font-bold mt-1 drop-shadow-lg">
                {evolutionData.to.name}
              </p>
            </div>
          </div>
        );
      })()}

      <div className="w-full max-w-6xl h-[92vh] flex gap-6">
        {/* 사이드바 (데스크톱 전용) - 다마고치 */}
        <aside className={`hidden md:flex flex-col w-80 ${theme.sidebar} rounded-3xl shadow-2xl border-4 overflow-hidden transition-colors`}>
          {/* 다마고치 화면 */}
          <div className={`${theme.header} p-5`}>
            <div className={`${theme.tamaScreen} border-2 rounded-2xl p-5 flex flex-col items-center gap-2 relative overflow-hidden`}>
              <div className={`absolute top-2 right-2 px-2 py-0.5 rounded-full text-[10px] font-bold ${theme.levelBadge}`}>
                Lv.{stage.level}
              </div>
              <div className={`select-none ${'animate-bounce-slow'}`}>
                <CharIcon size="lg" />
              </div>
              <div className={`text-sm font-bold ${theme.sidebarText}`}>{displayStage.name}</div>
              <div className={`text-[10px] ${theme.sidebarSub} text-center italic px-2`}>
                &ldquo;{displayStage.desc}&rdquo;
              </div>
              <div className="w-full mt-2">
                <div className="flex justify-between text-[9px] font-mono mb-0.5">
                  <span className={theme.sidebarSub}>XP</span>
                  <span className={theme.sidebarSub}>
                    {nextStage ? `${xp} / ${nextStage.minXp}` : 'MAX'}
                  </span>
                </div>
                <div className={`h-2 ${theme.xpTrack} rounded-full overflow-hidden border ${theme.divider}`}>
                  <div
                    className={`h-full ${theme.xpFill} transition-all duration-700`}
                    style={{ width: `${xpProgress}%` }}
                  />
                </div>
                {nextStage && (
                  <div className={`text-[9px] ${theme.sidebarSub} text-center mt-1`}>
                    다음 진화까지 {xpToNext} XP · {nextStage.emoji} {nextStage.name}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* 진화 타임라인 */}
          <div className={`px-5 py-3 border-b ${theme.divider}`}>
            <h3 className={`text-xs font-bold uppercase tracking-wider ${theme.sidebarSub} mb-2`}>성장 기록</h3>
            <div className="flex items-center gap-1">
              {EVOLUTIONS.map((evo) => {
                const reached = stage.level >= evo.level;
                const isCurrent = stage.level === evo.level && !hiddenForm;
                return (
                  <div key={evo.level} className="flex items-center">
                    <div className={`relative w-9 h-9 rounded-full flex items-center justify-center overflow-hidden transition-all ${isCurrent ? `ring-2 ring-yellow-400 scale-110` : ''}`}>
                      {evo.image ? (
                        <img
                          src={evo.image}
                          alt={reached ? evo.name : '???'}
                          className={`w-full h-full object-contain scale-[2.5] ${reached ? '' : 'brightness-0 opacity-25'}`}
                          style={reached ? undefined : { filter: 'brightness(0) opacity(0.25)' }}
                        />
                      ) : (
                        <span className={`text-lg ${reached ? '' : 'opacity-25 grayscale'}`}>{evo.emoji}</span>
                      )}
                    </div>
                    {evo.level < 6 && <span className={`text-[8px] mx-0.5 ${theme.sidebarSub}`}>›</span>}
                  </div>
                );
              })}
            </div>
            {/* 히든폼 슬롯 (Lv3 이상에서 표시) */}
            {stage.level >= 3 && (
              <div className="flex items-center gap-1.5 mt-2">
                <span className={`text-[9px] ${theme.sidebarSub} mr-1`}>HIDDEN</span>
                {(['dark', 'angel', 'zombie', 'phoenix'] as HiddenFormType[]).map((form) => {
                  const discovered = hiddenForm === form;
                  const h = HIDDEN_FORMS[form];
                  return (
                    <div key={form} className={`w-7 h-7 rounded-full flex items-center justify-center overflow-hidden ${discovered ? 'ring-1 ring-purple-400' : ''}`}>
                      {discovered && h.image ? (
                        <img src={h.image} alt={h.name} className="w-full h-full object-contain scale-[2.5]" />
                      ) : (
                        <span className={`text-[10px] font-bold ${theme.sidebarSub} opacity-40`}>?</span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* 스탯 패널 */}
          <div className={`flex-1 p-5 space-y-5 overflow-y-auto ${isDark ? 'dark-scrollbar' : 'light-scrollbar'}`}>
            <div>
              <h3 className={`text-xs font-bold uppercase tracking-wider ${theme.sidebarSub} mb-3`}>상태</h3>
              <div className="space-y-3">
                <StatBar label="친밀도" value={stats.closeness} icon="🗣️" />
                <StatBar label="애정도" value={stats.affection} icon="❤️" />
                <StatBar label="기분"   value={stats.mood}      icon="😊" />
              </div>
              <p className={`text-[10px] ${theme.sidebarSub} mt-3 leading-relaxed`}>
                💬 대화할수록 친밀도 +10 XP<br />
                🤍 하트를 눌러주면 애정도 +25 XP<br />
                🌱 XP가 쌓이면 진화해요!
              </p>
            </div>

            <div>
              <h3 className={`text-xs font-bold uppercase tracking-wider ${theme.sidebarSub} mb-2`}>기록</h3>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className={`${theme.tamaScreen} border rounded-xl p-2`}>
                  <div className={`text-[9px] ${theme.sidebarSub}`}>💬 대화</div>
                  <div className={`text-base font-bold ${theme.sidebarText}`}>{stats.userMessages}</div>
                </div>
                <div className={`${theme.tamaScreen} border rounded-xl p-2`}>
                  <div className={`text-[9px] ${theme.sidebarSub}`}>🐤 응답</div>
                  <div className={`text-base font-bold ${theme.sidebarText}`}>{stats.botMessages}</div>
                </div>
                <div className={`${theme.tamaScreen} border rounded-xl p-2`}>
                  <div className={`text-[9px] ${theme.sidebarSub}`}>❤️ 하트</div>
                  <div className={`text-base font-bold ${theme.sidebarText}`}>{stats.likeCount}</div>
                </div>
              </div>
            </div>

            <div>
              <h3 className={`text-xs font-bold uppercase tracking-wider ${theme.sidebarSub} mb-2`}>빠른 주제</h3>
              <div className="flex flex-col gap-2">
                {QUICK_REPLIES.map(q => (
                  <button
                    key={q}
                    type="button"
                    onClick={() => handleSend(q)}
                    disabled={isLoading}
                    className={`text-xs px-3 py-2 rounded-full border ${theme.quickChip} transition shadow-sm text-left disabled:opacity-50`}
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className={`p-4 border-t ${theme.divider} flex gap-2`}>
            <button
              type="button"
              onClick={() => setIsDark(v => !v)}
              className={`flex-1 py-2 rounded-full border ${theme.quickChip} text-xs transition`}
            >
              {isDark ? '☀️ 라이트' : '🌙 다크'}
            </button>
            <button
              type="button"
              onClick={handleClear}
              className={`flex-1 py-2 rounded-full border ${theme.quickChip} text-xs transition`}
            >
              🗑️ 초기화
            </button>
          </div>
        </aside>

        {/* 채팅 영역 */}
        <main className={`flex-1 ${theme.frame} rounded-3xl shadow-2xl flex flex-col overflow-hidden border-4 transition-colors relative`}>
          {/* 레벨업 배너 */}
          {levelUpStage && (() => {
            const isHidden = hiddenForm && HIDDEN_FORMS[hiddenForm];
            const bannerBg = isHidden
              ? hiddenForm === 'dark' ? 'from-purple-600 to-gray-900'
              : hiddenForm === 'angel' ? 'from-sky-300 to-yellow-200'
              : hiddenForm === 'zombie' ? 'from-green-800 to-gray-700'
              : 'from-orange-500 to-red-600'
              : 'from-yellow-400 to-amber-500';
            const bannerTitle = isHidden ? '??? HIDDEN FORM ???' : levelUpStage.level === 2 ? 'HATCH!' : 'LEVEL UP!';
            const bannerDesc = isHidden
              ? HIDDEN_FORMS[hiddenForm!].bannerText
              : levelUpStage.level === 2
                ? `알에서 깨어났어요! ${levelUpStage.emoji}`
                : `${levelUpStage.name}(으)로 진화했어요!`;
            return (
              <div className={`absolute top-4 left-1/2 -translate-x-1/2 z-20 bg-gradient-to-r ${bannerBg} text-white px-5 py-3 rounded-full shadow-2xl animate-pop flex items-center gap-3`}>
                <span className="text-2xl">{levelUpStage.image ? <img src={levelUpStage.image} alt="" className="w-8 h-8 object-contain inline" /> : levelUpStage.emoji}</span>
                <div>
                  <div className="text-[10px] font-bold opacity-90">{bannerTitle}</div>
                  <div className="text-sm font-bold whitespace-nowrap">{bannerDesc}</div>
                </div>
                <span className="text-2xl">{isHidden ? '🔮' : '✨'}</span>
              </div>
            );
          })()}

          {/* 모바일 헤더 */}
          <header className={`md:hidden ${theme.header} px-5 py-4 flex items-center gap-3 shadow-sm`}>
            <div className={`w-11 h-11 rounded-full ${displayStage.image ? '' : 'bg-white'} flex items-center justify-center shadow animate-bounce-slow overflow-hidden`}>
              <CharIcon size="sm" />
            </div>
            <div className="flex-1">
              <h1 className={`font-bold ${theme.headerText} text-lg leading-tight`}>
                삐약이 Lv.{stage.level}
              </h1>
              <p className={`text-xs ${theme.headerSub}`}>{displayStage.name}</p>
            </div>
            <button type="button" onClick={() => setIsDark(v => !v)} className={`w-9 h-9 rounded-full flex items-center justify-center ${theme.iconBtn} transition`}>
              {isDark ? '☀️' : '🌙'}
            </button>
            <button type="button" onClick={handleClear} className={`w-9 h-9 rounded-full flex items-center justify-center ${theme.iconBtn} transition`}>
              🗑️
            </button>
          </header>

          {/* 데스크톱 헤더 */}
          <header className={`hidden md:flex ${theme.header} px-6 py-4 items-center gap-3 shadow-sm`}>
            <div className={`w-10 h-10 rounded-full ${displayStage.image ? '' : 'bg-white'} flex items-center justify-center shadow overflow-hidden`}>
              <CharIcon size="sm" />
            </div>
            <div className="flex-1">
              <h1 className={`font-bold ${theme.headerText} text-base leading-tight`}>
                삐약이와의 대화 · Lv.{stage.level} {displayStage.name}
              </h1>
              <p className={`text-xs ${theme.headerSub}`}>
                {isLoading ? '입력 중...' : '온라인'}
                {isLoading && <span className="ml-1 inline-block w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />}
              </p>
            </div>
          </header>

          {/* 대화 영역 */}
          <div ref={scrollRef} className={`flex-1 overflow-y-auto px-4 md:px-8 py-5 md:py-8 space-y-3 ${theme.body} ${isDark ? 'dark-scrollbar' : 'light-scrollbar'} transition-colors chat-pattern-${isDark ? 'dark' : 'light'}`}>
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full gap-4">
                <div className="animate-bounce-slow">
                  <CharIcon size="xl" />
                </div>
                {stage.level === 1 ? (
                  <div className="relative">
                    {/* 떠다니는 이모지 */}
                    <span className="absolute -top-16 -left-8 text-xl animate-float-1 opacity-60">✨</span>
                    <span className="absolute -top-12 -right-6 text-lg animate-float-2 opacity-50">💛</span>
                    <span className="absolute -top-4 -left-12 text-base animate-float-3 opacity-40">🐣</span>
                    <span className="absolute -bottom-4 -right-10 text-xl animate-float-1 opacity-50">✨</span>
                    <span className="absolute -bottom-8 -left-6 text-base animate-float-2 opacity-40">💛</span>

                    <div className={`${isDark ? 'bg-gray-700/60 border-yellow-600/50' : 'bg-white/70 border-yellow-300/70'} backdrop-blur border-2 rounded-2xl px-6 md:px-10 py-6 shadow-xl text-center space-y-3 w-fit mx-auto`}>
                      <p className={`text-base md:text-lg font-bold whitespace-nowrap ${isDark ? 'text-yellow-300' : 'text-yellow-700'}`}>
                        알 속에서 무언가 꿈틀거리고 있어요...
                      </p>
                      <p className={`text-xs md:text-sm whitespace-nowrap ${theme.empty}`}>
                        톡톡! 작은 부리가 껍질을 두드리고 있어요 🥚
                      </p>
                      <p className={`text-xs md:text-sm whitespace-nowrap ${theme.empty}`}>
                        삐약이가 곧 나올 것 같아요!
                      </p>
                      <div className={`w-12 mx-auto border-t ${isDark ? 'border-yellow-600/40' : 'border-yellow-200'}`} />
                      <p className={`text-sm md:text-base font-semibold whitespace-nowrap ${isDark ? 'text-yellow-200' : 'text-yellow-600'}`}>
                        말을 걸어서 삐약이가 알을 깨고 나올 수 있게 도와주세요 💛
                      </p>
                    </div>
                  </div>
                ) : (
                  <p className={`text-sm md:text-base ${theme.empty} text-center`}>
                    삐약이에게 아무 말이나 걸어보세요!
                  </p>
                )}
                <div className="flex flex-wrap gap-2 justify-center px-4 mt-2 md:hidden">
                  {QUICK_REPLIES.map(q => (
                    <button
                      key={q}
                      type="button"
                      onClick={() => handleSend(q)}
                      className={`text-xs px-3 py-2 rounded-full border ${theme.quickChip} transition shadow-sm`}
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map(m => {
              const isUser = m.role === 'user';
              const ts = timestamps[m.id];
              const liked = likes[m.id];
              return (
                <div key={m.id} className={`flex items-end gap-2 ${isUser ? 'justify-end' : 'justify-start'} animate-msg-in`}>
                  {!isUser && (
                    <div className={`w-8 h-8 rounded-full ${displayStage.image ? '' : theme.botAvatarBg} flex items-center justify-center shrink-0 overflow-hidden`}>
                      <CharIcon size="sm" />
                    </div>
                  )}
                  <div className={`flex flex-col ${isUser ? 'items-end' : 'items-start'} max-w-[75%] md:max-w-[60%]`}>
                    <div
                      className={`relative px-4 py-2.5 text-sm md:text-[15px] whitespace-pre-wrap break-words ${
                        isUser
                          ? `${theme.userBubble} rounded-2xl rounded-br-sm shadow-md backdrop-blur-sm`
                          : `${theme.botBubble} rounded-2xl rounded-bl-sm border shadow-md backdrop-blur-sm`
                      }`}
                    >
                      {m.parts.map((part, i) => (part.type === 'text' ? <span key={i}>{part.text}</span> : null))}
                    </div>
                    <div className={`flex items-center gap-1.5 mt-1 px-1 ${isUser ? 'flex-row-reverse' : ''}`}>
                      {ts && <span className={`text-[10px] ${theme.timeText}`}>{formatTime(ts)}</span>}
                      {!isUser && (
                        <>
                          <button type="button" onClick={() => toggleLike(m.id)} className="text-xs hover:scale-125 transition-transform" title="좋아요">
                            {liked ? '❤️' : '🤍'}
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              handleCopy(
                                m.id,
                                m.parts.map(p => (p.type === 'text' ? p.text : '')).join(''),
                              )
                            }
                            className={`text-[10px] ${theme.timeText} hover:scale-110 transition-transform`}
                            title="복사"
                          >
                            {copiedId === m.id ? '✅' : '📋'}
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}

            {isLoading && (
              <div className="flex items-end gap-2 justify-start">
                <div className={`w-8 h-8 rounded-full ${theme.botAvatarBg} flex items-center justify-center text-lg shrink-0`}>
                  {displayStage.headerEmoji}
                </div>
                <div className={`${theme.botBubble} px-4 py-3 rounded-2xl rounded-bl-sm border shadow-sm`}>
                  <div className="flex gap-1">
                    <span className="w-2 h-2 bg-yellow-400 rounded-full animate-bounce [animation-delay:-0.3s]" />
                    <span className="w-2 h-2 bg-yellow-400 rounded-full animate-bounce [animation-delay:-0.15s]" />
                    <span className="w-2 h-2 bg-yellow-400 rounded-full animate-bounce" />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* 스크롤 하단 버튼 */}
          {showScrollBtn && (
            <button
              type="button"
              onClick={() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })}
              className={`absolute bottom-20 right-6 w-10 h-10 rounded-full shadow-lg flex items-center justify-center transition-all hover:scale-110 z-10 ${
                isDark ? 'bg-gray-700 text-yellow-400' : 'bg-white text-yellow-600 border border-yellow-200'
              }`}
            >
              ↓
            </button>
          )}

          {/* 입력창 */}
          <form
            onSubmit={e => {
              e.preventDefault();
              handleSend(input);
            }}
            className={`p-3 md:p-4 ${theme.inputBar} border-t flex gap-2 transition-colors`}
          >
            <textarea
              className={`flex-1 px-4 md:px-5 py-2.5 md:py-3 ${theme.inputField} rounded-2xl outline-none text-sm md:text-base focus:ring-2 focus:ring-yellow-300 transition resize-none max-h-32`}
              value={input}
              rows={1}
              placeholder={stage.level === 1 ? '알에게 말을 걸어보세요...' : '메시지를 입력하세요...'}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSend(input);
                }
              }}
              onInput={e => {
                const t = e.currentTarget;
                t.style.height = 'auto';
                t.style.height = `${Math.min(t.scrollHeight, 128)}px`;
              }}
              disabled={isLoading}
            />
            <button
              type="submit"
              disabled={isLoading || !input.trim()}
              className={`${theme.sendBtn} disabled:bg-gray-300 disabled:text-gray-500 font-bold w-11 h-11 rounded-full transition-all shadow-sm flex items-center justify-center text-lg shrink-0 active:scale-90 active:shadow-none hover:shadow-md send-btn-ripple`}
            >
              {isLoading ? (
                <span className="w-5 h-5 border-2 border-current border-t-transparent rounded-full animate-spin" />
              ) : (
                <span>➤</span>
              )}
            </button>
          </form>
        </main>
      </div>

      <style jsx global>{`
        @keyframes bounce-slow {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-4px); }
        }
        .animate-bounce-slow {
          animation: bounce-slow 2s ease-in-out infinite;
        }
        @keyframes wiggle {
          0%, 100% { transform: rotate(-3deg); }
          50% { transform: rotate(3deg); }
        }
        .animate-wiggle {
          animation: wiggle 0.8s ease-in-out infinite;
        }
        @keyframes pop {
          0% { transform: translate(-50%, -20px) scale(0.8); opacity: 0; }
          50% { transform: translate(-50%, 0) scale(1.05); opacity: 1; }
          100% { transform: translate(-50%, 0) scale(1); opacity: 1; }
        }
        .animate-pop {
          animation: pop 0.5s ease-out;
        }
        /* === 진화 이펙트 === */
        @keyframes evo-backdrop {
          0% { opacity: 0; }
          8% { opacity: 1; }
          92% { opacity: 1; }
          100% { opacity: 0; }
        }
        .animate-evo-backdrop { animation: evo-backdrop 5s ease-in-out forwards; }

        @keyframes evo-old {
          0% { opacity: 1; filter: brightness(1); transform: scale(1); }
          15% { opacity: 1; filter: brightness(1.3); transform: scale(1.03); }
          25% { opacity: 1; filter: brightness(2); transform: scale(1.06); }
          30% { opacity: 1; filter: brightness(2.5); transform: scale(1.08); }
          35% { opacity: 1; filter: brightness(4); transform: scale(1.15); }
          40% { opacity: 0; filter: brightness(6); transform: scale(1.4); }
          100% { opacity: 0; }
        }
        .animate-evo-old { animation: evo-old 5s ease-in-out forwards; }

        @keyframes evo-flash-1 {
          0%, 36% { opacity: 0; }
          40% { opacity: 0.75; }
          48% { opacity: 0; }
          100% { opacity: 0; }
        }
        .animate-evo-flash-1 { animation: evo-flash-1 5s ease-in-out forwards; }

        @keyframes evo-flash-2 {
          0%, 44% { opacity: 0; }
          48% { opacity: 0.5; }
          56% { opacity: 0; }
          100% { opacity: 0; }
        }
        .animate-evo-flash-2 { animation: evo-flash-2 5s ease-in-out forwards; }

        @keyframes evo-rays {
          0%, 30% { opacity: 0; transform: scale(0.3) rotate(0deg); }
          40% { opacity: 0.6; transform: scale(1) rotate(15deg); }
          55% { opacity: 0.8; transform: scale(1.2) rotate(30deg); }
          75% { opacity: 0.3; transform: scale(1.5) rotate(45deg); }
          100% { opacity: 0; transform: scale(2) rotate(60deg); }
        }
        .animate-evo-rays { animation: evo-rays 5s ease-out forwards; }

        @keyframes evo-ring {
          0% { transform: scale(1); opacity: 0.8; }
          100% { transform: scale(12); opacity: 0; }
        }
        .animate-evo-ring-1 { animation: evo-ring 1.5s ease-out 1.8s forwards; opacity: 0; animation-fill-mode: backwards; }
        .animate-evo-ring-2 { animation: evo-ring 1.5s ease-out 2.1s forwards; opacity: 0; animation-fill-mode: backwards; }
        .animate-evo-ring-3 { animation: evo-ring 1.5s ease-out 2.4s forwards; opacity: 0; animation-fill-mode: backwards; }

        @keyframes evo-shake {
          0%, 45% { transform: translate(0, 0); }
          46% { transform: translate(-3px, 2px); }
          47% { transform: translate(3px, -2px); }
          48% { transform: translate(-2px, -3px); }
          49% { transform: translate(2px, 3px); }
          50% { transform: translate(-3px, -1px); }
          51% { transform: translate(0, 0); }
          100% { transform: translate(0, 0); }
        }
        .animate-evo-shake { animation: evo-shake 5s ease-in-out forwards; }

        @keyframes evo-new {
          0%, 50% { opacity: 0; transform: scale(0.2); filter: brightness(4); }
          60% { opacity: 1; transform: scale(1.15); filter: brightness(1.5); }
          68% { opacity: 1; transform: scale(0.92); filter: brightness(1.1); }
          75% { opacity: 1; transform: scale(1.05); filter: brightness(1); }
          82% { opacity: 1; transform: scale(0.98); }
          88% { opacity: 1; transform: scale(1); }
          100% { opacity: 1; transform: scale(1); }
        }
        .animate-evo-new { animation: evo-new 5s ease-out forwards; }

        @keyframes evo-orbit {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        .animate-evo-orbit-1 { animation: evo-orbit 2s linear infinite; }
        .animate-evo-orbit-2 { animation: evo-orbit 3s linear infinite reverse; }

        @keyframes evo-sparkles {
          0%, 50% { opacity: 0; }
          65% { opacity: 1; }
          92% { opacity: 1; }
          100% { opacity: 0; }
        }
        .animate-evo-sparkles { animation: evo-sparkles 5s ease-in-out forwards; }

        @keyframes evo-name {
          0%, 62% { opacity: 0; transform: translateY(20px) scale(0.8); }
          72% { opacity: 1; transform: translateY(-5px) scale(1.05); }
          80% { opacity: 1; transform: translateY(0) scale(1); }
          92% { opacity: 1; }
          100% { opacity: 0; }
        }
        .animate-evo-name { animation: evo-name 5s ease-out forwards; }

        @keyframes float-1 {
          0%, 100% { transform: translateY(0) rotate(0deg); }
          50% { transform: translateY(-12px) rotate(8deg); }
        }
        @keyframes float-2 {
          0%, 100% { transform: translateY(0) rotate(0deg); }
          50% { transform: translateY(-8px) rotate(-6deg); }
        }
        @keyframes float-3 {
          0%, 100% { transform: translateY(0) rotate(0deg); }
          50% { transform: translateY(-15px) rotate(10deg); }
        }
        .animate-float-1 { animation: float-1 3s ease-in-out infinite; }
        .animate-float-2 { animation: float-2 4s ease-in-out infinite 0.5s; }
        .animate-float-3 { animation: float-3 3.5s ease-in-out infinite 1s; }
        @keyframes msg-in {
          from {
            opacity: 0;
            transform: translateY(12px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        .animate-msg-in {
          animation: msg-in 0.3s ease-out;
        }
        .dark-scrollbar::-webkit-scrollbar {
          width: 6px;
        }
        .dark-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .dark-scrollbar::-webkit-scrollbar-thumb {
          background: #4b5563;
          border-radius: 3px;
        }
        .dark-scrollbar::-webkit-scrollbar-thumb:hover {
          background: #6b7280;
        }
        .send-btn-ripple {
          position: relative;
          overflow: hidden;
        }
        .send-btn-ripple::after {
          content: '';
          position: absolute;
          inset: 0;
          background: radial-gradient(circle, rgba(255,255,255,0.4) 0%, transparent 70%);
          opacity: 0;
          transform: scale(0);
          transition: none;
        }
        .send-btn-ripple:active::after {
          opacity: 1;
          transform: scale(2);
          transition: transform 0.4s ease-out, opacity 0.4s ease-out;
        }
        .chat-pattern-light {
          background-image: radial-gradient(circle, #f5d87a15 1px, transparent 1px),
                            radial-gradient(circle, #f5d87a10 1.5px, transparent 1.5px);
          background-size: 24px 24px, 36px 36px;
          background-position: 0 0, 12px 12px;
        }
        .chat-pattern-dark {
          background-image: radial-gradient(circle, #ffffff08 1px, transparent 1px),
                            radial-gradient(circle, #ffffff05 1.5px, transparent 1.5px);
          background-size: 24px 24px, 36px 36px;
          background-position: 0 0, 12px 12px;
        }
        .light-scrollbar::-webkit-scrollbar {
          width: 6px;
        }
        .light-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .light-scrollbar::-webkit-scrollbar-thumb {
          background: #d1d5db;
          border-radius: 3px;
        }
        .light-scrollbar::-webkit-scrollbar-thumb:hover {
          background: #9ca3af;
        }
      `}</style>
    </div>
  );
}
