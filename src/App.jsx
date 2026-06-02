import React, { useState, useMemo, useEffect, useCallback } from 'react';

// 遊戲資料庫
const GAME_DATABASE = {
  ptcg: {
    id: 'ptcg',
    name: '寶可夢 (PTCG)',
    packs: [
      { cost: 43.2, price: 54, label: '43.2 (售價 $54)' },
      { cost: 64, price: 79, label: '64.0 (售價 $79)' },
    ],
  },
  ucg: {
    id: 'ucg',
    name: '超人力霸王 (UCG)',
    packs: [{ cost: 47.21, price: 59, label: '47.21 (售價 $59)' }],
  },
  godzilla: {
    id: 'godzilla',
    name: '哥吉拉',
    packs: [{ cost: 104.32, price: 120, label: '104.32 (售價 $120)' }],
  },
  nivel: {
    id: 'nivel',
    name: 'Nivel Arena',
    packs: [{ cost: 35.525, price: 45, label: '35.525 (售價 $45)' }],
  },
};

const ChevronIcon = ({ expanded, className = "text-slate-400" }) => (
  <svg className={`w-3.5 h-3.5 transition-transform duration-300 ${expanded ? 'rotate-180' : ''} ${className}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
  </svg>
);

const nCr = (n, r) => {
  if (r < 0 || r > n) return 0;
  let res = 1;
  for (let i = 1; i <= r; i++) res = res * (n - i + 1) / i;
  return res;
};

const closestStandard = (p) => {
  const standards = [4, 8, 12, 16, 20, 24, 28, 32];
  return standards.reduce((prev, curr) => Math.abs(curr - p) < Math.abs(prev - p) ? curr : prev);
};

const getSwissWorstCaseDist = (P, R) => {
  const key = `${P}_${R}`;
  const distTable = {
    "2_3":  { top: 1, sub: 0, mid: 0, lowMid: 0, bot: 1 },
    "3_3":  { top: 1, sub: 1, mid: 0, lowMid: 0, bot: 1 },
    "4_3":  { top: 1, sub: 1, mid: 0, lowMid: 0, bot: 2 },
    "5_3":  { top: 1, sub: 2, mid: 0, lowMid: 0, bot: 2 },
    "8_3":  { top: 1, sub: 3, mid: 0, lowMid: 0, bot: 4 },
    "9_3":  { top: 2, sub: 3, mid: 0, lowMid: 0, bot: 4 },
    "12_3": { top: 2, sub: 4, mid: 0, lowMid: 0, bot: 6 },
    "16_3": { top: 2, sub: 6, mid: 0, lowMid: 0, bot: 8 },
    "17_3": { top: 3, sub: 6, mid: 0, lowMid: 0, bot: 8 }, 
    "20_3": { top: 3, sub: 7, mid: 0, lowMid: 0, bot: 10 },
    "24_3": { top: 3, sub: 9, mid: 0, lowMid: 0, bot: 12 },
    "28_3": { top: 4, sub: 10, mid: 0, lowMid: 0, bot: 14 },
    "32_3": { top: 4, sub: 12, mid: 0, lowMid: 0, bot: 16 },
    "33_3": { top: 5, sub: 12, mid: 0, lowMid: 0, bot: 16 }, 

    "8_4":  { top: 1, sub: 2, mid: 0, lowMid: 2, bot: 3 },
    "9_4":  { top: 1, sub: 3, mid: 0, lowMid: 3, bot: 2 }, 
    "12_4": { top: 1, sub: 3, mid: 0, lowMid: 4, bot: 4 },
    "16_4": { top: 1, sub: 4, mid: 0, lowMid: 6, bot: 5 },
    "17_4": { top: 2, sub: 4, mid: 0, lowMid: 6, bot: 5 }, 
    "20_4": { top: 2, sub: 5, mid: 0, lowMid: 7, bot: 6 },
    "24_4": { top: 2, sub: 6, mid: 0, lowMid: 8, bot: 8 },
    "25_4": { top: 2, sub: 7, mid: 0, lowMid: 8, bot: 8 },
    "28_4": { top: 2, sub: 8, mid: 0, lowMid: 10, bot: 8 },
    "32_4": { top: 2, sub: 10, mid: 0, lowMid: 10, bot: 10 },
    "33_4": { top: 3, sub: 10, mid: 0, lowMid: 10, bot: 10 },

    "16_5": { top: 1, sub: 3, mid: 4, lowMid: 4, bot: 4 },
    "17_5": { top: 1, sub: 3, mid: 5, lowMid: 4, bot: 4 }, 
    "20_5": { top: 1, sub: 4, mid: 6, lowMid: 5, bot: 4 },
    "24_5": { top: 1, sub: 4, mid: 7, lowMid: 8, bot: 4 },
    "25_5": { top: 2, sub: 4, mid: 7, lowMid: 8, bot: 4 }, 
    "28_5": { top: 2, sub: 5, mid: 8, lowMid: 9, bot: 4 },
    "32_5": { top: 2, sub: 5, mid: 10, lowMid: 10, bot: 5 },
    "33_5": { top: 3, sub: 5, mid: 10, lowMid: 10, bot: 5 }  
  };
  if (distTable[key]) return distTable[key];

  const dist = { top: 0, sub: 0, mid: 0, lowMid: 0, bot: 0 };
  dist.top = Math.ceil(P * Math.pow(0.5, R));
  dist.sub = Math.ceil(P * R * Math.pow(0.5, R));
  if (R >= 5) {
    dist.mid = Math.ceil(P * nCr(R, 2) * Math.pow(0.5, R));
    dist.lowMid = Math.ceil(P * nCr(R, 3) * Math.pow(0.5, R));
  } else {
    dist.lowMid = Math.ceil(P * nCr(R, 2) * Math.pow(0.5, R));
  }
  dist.bot = Math.max(0, P - dist.top - dist.sub - dist.mid - dist.lowMid);
  return dist;
};

const FeeController = ({ value, onChange, theme }) => {
  const themes = {
    rose: { bg: 'bg-rose-100', text: 'text-rose-700', hover: 'hover:bg-rose-200', border: 'border-rose-200' },
    teal: { bg: 'bg-teal-100', text: 'text-teal-700', hover: 'hover:bg-teal-200', border: 'border-teal-200' },
    emerald: { bg: 'bg-emerald-100', text: 'text-emerald-700', hover: 'hover:bg-emerald-200', border: 'border-emerald-200' },
    blue: { bg: 'bg-blue-100', text: 'text-blue-700', hover: 'hover:bg-blue-200', border: 'border-blue-200' },
    indigo: { bg: 'bg-indigo-100', text: 'text-indigo-700', hover: 'hover:bg-indigo-200', border: 'border-indigo-200' }
  };
  const c = themes[theme] || themes.teal;

  return (
    <div className="flex justify-between items-center bg-slate-50/80 p-1.5 rounded-lg border border-slate-200 mb-2 shadow-sm">
      <span className="text-xs font-bold text-slate-500 pl-1 select-none">自訂門票</span>
      <div className="flex items-center gap-2">
         <button onClick={() => onChange(Math.max(50, value - 50))} className={`w-7 h-7 rounded-md ${c.bg} ${c.text} ${c.border} border font-black flex items-center justify-center ${c.hover} active:scale-95 transition-all shadow-sm`}>-</button>
         <span className={`${c.text} font-black text-sm w-11 text-center select-none`}>${value}</span>
         <button onClick={() => onChange(value + 50)} className={`w-7 h-7 rounded-md ${c.bg} ${c.text} ${c.border} border font-black flex items-center justify-center ${c.hover} active:scale-95 transition-all shadow-sm`}>+</button>
      </div>
    </div>
  );
};

export default function App() {
  const [selectedGame, setSelectedGame] = useState('ptcg'); 
  const [selectedPackIndex, setSelectedPackIndex] = useState(0);
  const [entryFee, setEntryFee] = useState(200); 
  const [targetMargin, setTargetMargin] = useState(38); 
  const [minMargin, setMinMargin] = useState(25);
  const [bottomPacks, setBottomPacks] = useState(1);
  const [rewardModel, setRewardModel] = useState('god'); 
  const [matchRounds, setMatchRounds] = useState('auto'); 
  const [currentPlayers, setCurrentPlayers] = useState(12);
  const [threePlayerMode, setThreePlayerMode] = useState('A');

  const [grandPrizeCost, setGrandPrizeCost] = useState(2000);
  const [grandPrizeMinMargin, setGrandPrizeMinMargin] = useState(20);

  // 方案五雙軌規格報名費
  const [fee2p, setFee2p] = useState(150);
  const [fee3p, setFee3p] = useState(200);
  
  const [fee3r, setFee3r] = useState(250);
  const [r3Mode, setR3Mode] = useState('pack'); 
  const [r3PrizeCost, setR3PrizeCost] = useState(1000);

  const [fee4r, setFee4r] = useState(300);
  const [r4Mode, setR4Mode] = useState('pack');
  const [r4PrizeCost, setR4PrizeCost] = useState(1500);

  const [fee5r, setFee5r] = useState(400);
  const [r5Mode, setR5Mode] = useState('pack');
  const [r5PrizeCost, setR5PrizeCost] = useState(2000);

  const [twoWinPolicy, setTwoWinPolicy] = useState('bottom');
  const [champGap, setChampGap] = useState(2);
  const [topTax, setTopTax] = useState(0);

  const [godPrizeConfig, setGodPrizeConfig] = useState({
    4: 600, 8: 1200, 12: 1800, 16: 2500, 20: 3200, 24: 4000, 28: 5000, 32: 6000,
  });
  const [godMidPacks, setGodMidPacks] = useState(1);
  const [godSubPacks, setGodSubPacks] = useState(2);

  const [godHelperA, setGodHelperA] = useState(8);
  const [godHelperValA, setGodHelperValA] = useState(1200);
  const [godHelperB, setGodHelperB] = useState(16);
  const [godHelperValB, setGodHelperValB] = useState(2500);

  const [fixedLotteryPacks, setFixedLotteryPacks] = useState(1);
  const [lotteryPrizeConfig, setLotteryPrizeConfig] = useState({
    8: 300, 12: 500, 16: 800, 20: 1100, 24: 1500, 28: 2000, 32: 2500,
  });

  const [lotteryHelperA, setLotteryHelperA] = useState(8);
  const [lotteryHelperValA, setLotteryHelperValA] = useState(300);
  const [lotteryHelperB, setLotteryHelperB] = useState(16);
  const [lotteryHelperValB, setLotteryHelperValB] = useState(800);

  const [isEmergencyEditable, setIsEmergencyEditable] = useState(false);
  const [overrideWinner2, setOverrideWinner2] = useState('');
  const [overrideLoser2, setOverrideLoser2] = useState('');
  const [overrideP1_A, setOverrideP1_A] = useState('');
  const [overrideP2_A, setOverrideP2_A] = useState('');
  const [overrideP3_A, setOverrideP3_A] = useState('');
  const [overrideP1_B, setOverrideP1_B] = useState('');
  const [overrideP2_B, setOverrideP2_B] = useState('');
  const [overrideP3_B, setOverrideP3_B] = useState('');

  const [expandedSections, setExpandedSections] = useState({
    round3: true, round4: true, round5Normal: true, round5Special: true,
    counterTable: true, alertCenter: true, posterMilestones: true, emergencyPanel: true, 
  });

  const [gymCardExpanded, setGymCardExpanded] = useState({ league: false, normal: true, grand: true });
  const [gymLeague2Expanded, setGymLeague2Expanded] = useState(false);
  const [gymLeague3Expanded, setGymLeague3Expanded] = useState(false);

  const [zoomLevel, setZoomLevel] = useState(100);
  const [packCost, setPackCost] = useState(GAME_DATABASE.ptcg.packs[0].cost);
  const [packPrice, setPackPrice] = useState(GAME_DATABASE.ptcg.packs[0].price);

  const toggleSection = (section) => setExpandedSections((prev) => ({ ...prev, [section]: !prev[section] }));
  const toggleGymCard = (card) => setGymCardExpanded((prev) => ({ ...prev, [card]: !prev[card] }));

  useEffect(() => {
    const targetPx = (zoomLevel / 100) * 16;
    document.documentElement.style.fontSize = `${targetPx}px`;
  }, [zoomLevel]);

  useEffect(() => {
    if (rewardModel === 'official-gym') {
      setSelectedGame('ptcg');
      setPackCost(GAME_DATABASE.ptcg.packs[0].cost);
      setPackPrice(GAME_DATABASE.ptcg.packs[0].price);
      setEntryFee(300);
      setMatchRounds('3');
    } else if (rewardModel === 'custom-spec') {
      setMatchRounds('auto');
    } else {
      setMatchRounds('auto'); 
    }
  }, [rewardModel]);

  const handleGameChange = (e) => {
    if (rewardModel === 'official-gym') return;
    const gameId = e.target.value;
    const firstPack = GAME_DATABASE[gameId].packs[0];
    setSelectedGame(gameId);
    setSelectedPackIndex(0);
    setPackCost(firstPack.cost);
    setPackPrice(firstPack.price);
  };

  const handlePackChange = (e) => {
    if (rewardModel === 'official-gym') return; 
    const index = Number(e.target.value);
    const pack = GAME_DATABASE[selectedGame].packs[index];
    setSelectedPackIndex(index);
    if (pack) { setPackCost(pack.cost); setPackPrice(pack.price); }
  };

  const applyLinearTrend = useCallback((modelType, p1, v1, p2, v2) => {
    const numP1 = Number(p1); const numP2 = Number(p2); const numV1 = Number(v1); const numV2 = Number(v2);
    if (isNaN(numP1) || isNaN(numP2) || isNaN(numV1) || isNaN(numV2) || numP1 === numP2) return; 

    const slope = (numV2 - numV1) / (numP2 - numP1);
    const intercept = numV1 - slope * numP1;
    const newConfig = {};
    const points = modelType === 'god' ? [4, 8, 12, 16, 20, 24, 28, 32] : [8, 12, 16, 20, 24, 28, 32];
    
    points.forEach(p => {
      const rawVal = slope * p + intercept;
      const val = Math.max(0, Math.ceil(rawVal / 50) * 50); 
      newConfig[p] = val;
    });

    if (modelType === 'god') setGodPrizeConfig(prev => ({ ...prev, ...newConfig }));
    else setLotteryPrizeConfig(prev => ({ ...prev, ...newConfig }));
  }, []);

  // V9.9.11 方案二專屬：一鍵套用逆推數據與大賽模組預設
  const applyReverseConfig = (fee, players) => {
    if (players > 100) return;
    const p = closestStandard(players); // 對齊到最接近的人數級距以顯示於對照表
    setEntryFee(fee);
    setCurrentPlayers(p);
    setGodPrizeConfig(prev => ({ ...prev, [p]: Number(grandPrizeCost) }));
  };

  const applyPresetEvent = (fee, botPacks, players) => {
    setEntryFee(fee);
    setBottomPacks(botPacks);
    setCurrentPlayers(players);
    setGodPrizeConfig(prev => ({ ...prev, [players]: Number(grandPrizeCost) }));
  };

  const resetGodMode = () => {
    setEntryFee(200);
    setBottomPacks(1);
    setCurrentPlayers(12);
    setGodPrizeConfig({
      4: 600, 8: 1200, 12: 1800, 16: 2500, 20: 3200, 24: 4000, 28: 5000, 32: 6000,
    });
  };

  const calcCustomFormatPacks = useCallback((fee, rounds, standardPlayers, mode = 'pack', prizeCost = 0) => {
    const isPTCG = selectedGame === 'ptcg';
    const step = isPTCG ? 3 : 1;

    // --- 🎁 實體大獎模式 (逆推人數) ---
    if (mode === 'prize') {
      let defaultSub = step;
      if (rounds === 4) defaultSub = isPTCG ? 6 : 2;
      if (rounds === 5) defaultSub = isPTCG ? 6 : 2;

      let bestP = -1;
      let finalMargin = 0;
      let finalCost = 0;
      const startP = rounds === 3 ? 4 : (rounds === 4 ? 9 : 17);

      for (let p = startP; p <= 100; p++) {
        const rev = p * fee;
        const dist = getSwissWorstCaseDist(p, rounds);
        const botMultiplier = dist.mid + dist.lowMid + dist.bot;
        const packsCost = (dist.sub * defaultSub + botMultiplier * bottomPacks) * packCost;
        const totalCost = prizeCost + packsCost;
        const margin = ((rev - totalCost) / rev) * 100;

        if (margin >= targetMargin) {
           bestP = p; finalMargin = margin; finalCost = totalCost;
           break;
        }
      }

      return {
         isPrizeMode: true, prizeCost, sub: defaultSub, bot: bottomPacks,
         minPlayers: bestP, margin: finalMargin, totalCost: finalCost
      };
    }

    // --- ⚡ 純補充包模式 (1.5倍鋼鐵約束) ---
    const rev = standardPlayers * fee;
    const dist = getSwissWorstCaseDist(standardPlayers, rounds);
    const botMultiplier = dist.mid + dist.lowMid + dist.bot;

    let bestTop = step;
    let bestSub = step;
    let bestMargin = -100;
    let hasSolution = false;

    for (let s = step; s <= 50; s += step) {
      const minTop = Math.ceil((s * 1.5 + (isPTCG ? 3 : 1)) / step) * step;
      for (let t = minTop; t <= 50; t += step) {
        const totalPacks = dist.top * t + dist.sub * s + botMultiplier * bottomPacks;
        const totalCost = totalPacks * packCost;
        const currentMargin = ((rev - totalCost) / rev) * 100;

        if (currentMargin >= targetMargin) {
          if (t + s > bestTop + bestSub || !hasSolution) {
            bestTop = t; bestSub = s; bestMargin = currentMargin;
            hasSolution = true;
          }
        }
      }
    }

    if (!hasSolution) {
      bestSub = step;
      bestTop = Math.ceil((step * 1.5 + (isPTCG ? 3 : 1)) / step) * step;
      const totalPacks = dist.top * bestTop + dist.sub * bestSub + botMultiplier * bottomPacks;
      bestMargin = rev > 0 ? ((rev - (totalPacks * packCost)) / rev) * 100 : 0;
    }

    const totalCost = (dist.top * bestTop + dist.sub * bestSub + botMultiplier * bottomPacks) * packCost;

    return { 
      isPrizeMode: false, top: bestTop, sub: bestSub, bot: bottomPacks, margin: bestMargin, 
      rev, dist, totalCost, topCost: bestTop * packCost, topValue: bestTop * packPrice 
    };
  }, [selectedGame, targetMargin, packCost, packPrice, bottomPacks]);

  const customSpecData = useMemo(() => {
    // 2P 單挑決鬥
    const rev2 = 2 * fee2p;
    const budget2 = rev2 * (1 - targetMargin / 100);
    let w2 = bottomPacks;
    for (let i = bottomPacks; i <= 50; i++) {
      if ((i + bottomPacks) * packCost <= budget2) w2 = i;
      else break;
    }
    if (selectedGame === 'ptcg') w2 = Math.max(bottomPacks, Math.floor(w2 / 3) * 3);
    const cost2 = (w2 + bottomPacks) * packCost;
    const margin2 = rev2 > 0 ? ((rev2 - cost2) / rev2) * 100 : 0;
    const p2 = { w: w2, rev: rev2, cost: cost2, margin: margin2, topCost: w2 * packCost, topValue: w2 * packPrice };

    // 3P 循環賽
    const rev3 = 3 * fee3p;
    const budget3 = rev3 * (1 - targetMargin / 100);
    const step = selectedGame === 'ptcg' ? 3 : 1;
    let p1_3 = bottomPacks + step;
    let p2_3 = bottomPacks;
    let bestSum3 = 0;
    for (let j = bottomPacks; j <= 50; j += step) {
      for (let i = j + step; i <= 50; i += step) {
        if ((i + j + bottomPacks) * packCost <= budget3) {
          if (i + j > bestSum3) {
            bestSum3 = i + j;
            p1_3 = i; p2_3 = j;
          }
        }
      }
    }
    if (bestSum3 === 0) { p1_3 = bottomPacks; p2_3 = bottomPacks; }
    const cost3 = (p1_3 + p2_3 + bottomPacks) * packCost;
    const margin3 = rev3 > 0 ? ((rev3 - cost3) / rev3) * 100 : 0;
    const p3 = { p1: p1_3, p2: p2_3, rev: rev3, cost: cost3, margin: margin3, topCost: p1_3 * packCost, topValue: p1_3 * packPrice };

    return {
      p2,
      p3,
      r3: calcCustomFormatPacks(fee3r, 3, 8, r3Mode, r3PrizeCost),
      r4: calcCustomFormatPacks(fee4r, 4, 16, r4Mode, r4PrizeCost),
      r5: calcCustomFormatPacks(fee5r, 5, 32, r5Mode, r5PrizeCost),
    };
  }, [fee2p, fee3p, fee3r, fee4r, fee5r, r3Mode, r3PrizeCost, r4Mode, r4PrizeCost, r5Mode, r5PrizeCost, calcCustomFormatPacks, targetMargin, packCost, packPrice, bottomPacks, selectedGame]);

  const calculations = useMemo(() => {
    const isGodMode = rewardModel === 'god';
    const isPureLottery = rewardModel === 'pure-lottery';
    const isSmooth = rewardModel === 'smooth';
    const isGym = rewardModel === 'official-gym';
    const isCustomSpec = rewardModel === 'custom-spec';
    const isPTCG = selectedGame === 'ptcg';

    let adjustedGodMid = godMidPacks;
    let adjustedGodSub = godSubPacks;
    if (isPTCG) {
      adjustedGodMid = Math.ceil(godMidPacks / 3) * 3;
      adjustedGodSub = Math.ceil(godSubPacks / 3) * 3;
    }
    const finalGodMid = Math.max(bottomPacks, adjustedGodMid);
    const finalGodSub = Math.max(finalGodMid, adjustedGodSub);

    const middlePacks = Math.ceil(entryFee / packPrice);
    
    let actualMidPacks = middlePacks;
    let actualLowMidPacks = bottomPacks;

    if (isPTCG) {
      if (twoWinPolicy === 'half') { actualMidPacks = 6; actualLowMidPacks = 3; } 
      else { actualMidPacks = 3; actualLowMidPacks = bottomPacks; }
    } else {
      actualMidPacks = middlePacks;
      actualLowMidPacks = twoWinPolicy === 'half' ? Math.max(bottomPacks, Math.floor(middlePacks / 2)) : bottomPacks;
    }

    const calcSmooth = (players, dist) => {
      const rev = players * entryFee;
      const maxCost = rev * (1 - targetMargin / 100);
      const fixed = (dist.mid * actualMidPacks + dist.lowMid * actualLowMidPacks + dist.bot * bottomPacks) * packCost;
      const limitPacks = Math.floor((maxCost - fixed) / packCost);

      const step = isPTCG ? 3 : 1;
      let baseSub = dist.sub > 0 ? Math.ceil((actualMidPacks + 1) / step) * step : 0;
      let minTopNeeded = dist.sub > 0 ? baseSub + Math.max(step, champGap) : actualMidPacks + Math.max(step, champGap);
      let top = Math.ceil(minTopNeeded / step) * step;
      let sub = baseSub;

      let isCorrected = dist.top * top + dist.sub * sub > limitPacks;
      if (!isCorrected) {
        while (true) {
          if (dist.sub > 0 && (dist.top * (top + step) + dist.sub * (sub + step) <= limitPacks) && ((top + step) - (sub + step) >= Math.max(step, champGap))) {
            top += step; sub += step;
          } else if (dist.top * (top + step) + dist.sub * sub <= limitPacks) {
            top += step;
          } else break;
        }
      }

      let originalTop = top; let originalSub = sub;
      if (topTax > 0) {
        const taxAmount = topTax * step;
        top = top - taxAmount;
        if (sub > 0) sub = sub - taxAmount;
        
        if (sub > 0) {
          sub = Math.max(Math.ceil((actualMidPacks + 1) / step) * step, sub);
          top = Math.max(sub + Math.max(step, champGap), top);
        } else {
          top = Math.max(Math.ceil((actualMidPacks + Math.max(step, champGap)) / step) * step, top);
        }
      }

      const taxedPacks = (originalTop - top) * dist.top + (originalSub - sub) * dist.sub;
      const totalCost = (dist.top * top + dist.sub * sub) * packCost + fixed;
      return { top, sub, totalCost, margin: ((rev - totalCost) / rev) * 100, isCorrected, taxedPacks, taxedCash: taxedPacks * packCost };
    };

    const calcGod = (players) => {
      const rev = players * entryFee;
      const champBudget = godPrizeConfig[players] || 0;
      let costX1 = 0; let costX2 = 0; let costBot = 0;

      if (players === 32) { costX1 = 5 * finalGodSub; costX2 = 10 * finalGodMid; costBot = 16 * bottomPacks; } 
      else if (players === 28) { costX1 = 4 * finalGodSub; costX2 = 9 * finalGodMid; costBot = 14 * bottomPacks; } 
      else if (players === 24) { costX1 = 4 * finalGodSub; costX2 = 7 * finalGodMid; costBot = 12 * bottomPacks; } 
      else if (players === 20) { costX1 = 3 * finalGodSub; costX2 = 6 * finalGodMid; costBot = 10 * bottomPacks; } 
      else if (players === 16) { costX1 = 4 * finalGodSub; costX2 = 6 * finalGodMid; costBot = 5 * bottomPacks; } 
      else if (players === 12) { costX1 = 3 * finalGodSub; costX2 = 4 * finalGodMid; costBot = 4 * bottomPacks; } 
      else if (players === 8) { costX1 = 3 * finalGodSub; costX2 = 0; costBot = 4 * bottomPacks; } 
      else if (players === 4) { costX1 = 1 * finalGodSub; costX2 = 0; costBot = 2 * bottomPacks; }

      const fixedBaseCost = (costX1 + costX2 + costBot) * packCost;
      const totalCost = champBudget + fixedBaseCost;
      return { champBudget, maxChampBudget: rev * (1 - targetMargin / 100) - fixedBaseCost, totalCost, margin: ((rev - totalCost) / rev) * 100, suggestedFee: Math.ceil((totalCost / (1 - targetMargin / 100)) / players / 10) * 10 };
    };

    const calcLottery = (players) => {
      const rev = players * entryFee;
      const baseCost = players * fixedLotteryPacks * packCost;
      const prizeCost = lotteryPrizeConfig[players] || 0; 
      const totalCost = baseCost + prizeCost;
      return { totalCost, margin: ((rev - totalCost) / rev) * 100, surplusCash: rev - totalCost - (rev * (targetMargin / 100)), prizeInput: prizeCost, prizeCost };
    };

    const res4 = isSmooth ? calcSmooth(4, getSwissWorstCaseDist(4, 3)) : isGodMode ? calcGod(4) : calcLottery(4);
    const res8 = isSmooth ? calcSmooth(8, getSwissWorstCaseDist(8, 3)) : isGodMode ? calcGod(8) : calcLottery(8);
    const res12 = isSmooth ? calcSmooth(12, getSwissWorstCaseDist(12, 3)) : isGodMode ? calcGod(12) : calcLottery(12);
    const res16 = isSmooth ? calcSmooth(16, getSwissWorstCaseDist(16, 4)) : isGodMode ? calcGod(16) : calcLottery(16);
    const res20 = isSmooth ? calcSmooth(20, getSwissWorstCaseDist(20, 5)) : isGodMode ? calcGod(20) : calcLottery(20);
    const res24 = isSmooth ? calcSmooth(24, getSwissWorstCaseDist(24, 5)) : isGodMode ? calcGod(24) : calcLottery(24);
    const res28 = isSmooth ? calcSmooth(28, getSwissWorstCaseDist(28, 5)) : isGodMode ? calcGod(28) : calcLottery(28);
    const res32 = isSmooth ? calcSmooth(32, getSwissWorstCaseDist(32, 5)) : isGodMode ? calcGod(32) : calcLottery(32);

    if (isSmooth) {
      const step = isPTCG ? 3 : 1;
      const enforceInternal = (res, dist) => {
        if (dist.sub > 0) {
          if (res.sub < Math.ceil((actualMidPacks + 1) / step) * step) res.sub = Math.ceil((actualMidPacks + 1) / step) * step;
          if (res.top < Math.ceil((res.sub * 2) / step) * step) res.top = Math.ceil((res.sub * 2) / step) * step;
        } else {
          if (res.top < Math.ceil((actualMidPacks + Math.max(step, champGap)) / step) * step) res.top = Math.ceil((actualMidPacks + Math.max(step, champGap)) / step) * step;
        }
      };

      [res4, res8, res12, res16, res20, res24, res28, res32].forEach((r, i) => {
        enforceInternal(r, getSwissWorstCaseDist([4, 8, 12, 16, 20, 24, 28, 32][i], i <= 1 ? 3 : i <= 3 ? 4 : 5));
      });

      if (res8.top < res4.top) res8.top = res4.top;
      if (res12.top < res8.top + step) res12.top = res8.top + step;
      if (res16.top < res12.top) res16.top = res12.top;
      if (res20.top < res16.top + step) res20.top = res16.top + step;
      if (res24.top < res20.top) res24.top = res20.top;
      if (res28.top < res24.top) res28.top = res24.top;
      if (res32.top < res28.top) res32.top = res28.top;
      if (res16.sub < res12.sub) res16.sub = res12.sub;
      if (res20.sub < res16.sub) res20.sub = res16.sub;
      if (res24.sub < res20.sub) res24.sub = res20.sub;
      if (res28.sub < res24.sub) res28.sub = res24.sub;
      if (res32.sub < res28.sub) res32.sub = res28.sub;

      [res4, res8, res12, res16, res20, res24, res28, res32].forEach((r, i) => {
        const p = [4, 8, 12, 16, 20, 24, 28, 32][i];
        const rounds = p <= 8 ? 3 : p <= 16 ? 4 : 5;
        enforceInternal(r, getSwissWorstCaseDist(p, rounds));
        const dist = getSwissWorstCaseDist(p, rounds);
        r.totalCost = (dist.top * r.top + dist.sub * r.sub) * packCost + (dist.mid * actualMidPacks + dist.lowMid * actualLowMidPacks + dist.bot * bottomPacks) * packCost;
        r.margin = ((p * entryFee - r.totalCost) / (p * entryFee)) * 100;
      });
    }

    const getEventCostAndStats = (P) => {
      const rev = P * entryFee;
      const R = matchRounds === 'auto' ? (P <= 8 ? 3 : P <= 16 ? 4 : 5) : Number(matchRounds) || 3;
      let topReward = 0; let subReward = 0; let midReward = 0;

      if (R === 3) { topReward = res8.top || 0; subReward = isPTCG ? 3 : actualLowMidPacks; } 
      else if (R === 4) { topReward = res16.top || 0; subReward = res16.sub || 0; } 
      else { topReward = (P >= 25 ? res32.top : res24.top) || 0; subReward = (P >= 25 ? res32.sub : res24.sub) || 0; midReward = actualMidPacks; }

      const dist = getSwissWorstCaseDist(P, R);
      const totalCost = (dist.top * topReward + dist.sub * subReward + dist.mid * midReward + dist.lowMid * actualLowMidPacks + dist.bot * bottomPacks) * packCost;
      return { totalCost, margin: rev > 0 ? ((rev - totalCost) / rev) * 100 : 0, surplus: Math.max(0, rev - totalCost - (rev * targetMargin / 100)), R, suggestedFee: Math.ceil((totalCost / (1 - targetMargin / 100)) / P / 10) * 10 };
    };

    const getSurplusForPlayerCount = (P) => {
      const rev = P * entryFee;
      let totalCost = 0;
      if (isSmooth) totalCost = getEventCostAndStats(P).totalCost || 0;
      else if (isGodMode) totalCost = calcGod(P).totalCost || 0;
      else if (isGym) {
        if (P === 2) totalCost = (7 + 1) * packCost;
        else if (P === 3) {
          const emergencyData = getEmergencyStats();
          totalCost = (threePlayerMode === 'A' ? (emergencyData.p1_A + emergencyData.p2_A + emergencyData.p3_A) : (emergencyData.p1_B + emergencyData.p2_B + emergencyData.p3_B)) * packCost;
        } else {
          let dist = getSwissWorstCaseDist(P, 3);
          totalCost = (dist.top * 12 + dist.sub * 6 + dist.bot * 1) * packCost;
        }
      } else totalCost = calcLottery(P).totalCost || 0;
      return Math.max(0, rev - totalCost - (rev * (targetMargin / 100)));
    };

    const getEmergencyStats = () => {
      const step = isPTCG ? 3 : 1;
      const rev2 = 2 * entryFee;
      let baseWinner2 = bottomPacks;
      const budget2 = rev2 * (1 - targetMargin / 100);
      for (let w = bottomPacks; w <= 50; w++) if ((w + bottomPacks) * packCost <= budget2) baseWinner2 = w; else break;
      if (isPTCG) baseWinner2 = Math.max(bottomPacks, Math.floor(baseWinner2 / 3) * 3);
      
      const winnerPacks2 = overrideWinner2 !== '' ? Number(overrideWinner2) : baseWinner2;
      const loserPacks2 = overrideLoser2 !== '' ? Number(overrideLoser2) : bottomPacks;
      const cost2 = (winnerPacks2 + loserPacks2) * packCost;

      const rev3 = 3 * entryFee;
      const budget3 = rev3 * (1 - targetMargin / 100);
      let p1_A = bottomPacks + step; let p2_A = bottomPacks; let bestSumA = 0;
      for (let j = bottomPacks; j <= 50; j += step) {
        for (let i = j + step; i <= 50; i += step) {
          if ((i + j + bottomPacks) * packCost <= budget3 && i + j > bestSumA) { bestSumA = i + j; p1_A = i; p2_A = j; }
        }
      }
      if (bestSumA === 0) { p1_A = bottomPacks; p2_A = bottomPacks; }
      
      let p1_B = bottomPacks + step; let p2_B = bottomPacks; let bestSumB = 0;
      for (let j = bottomPacks; j <= 50; j += step) {
        for (let i = j + step; i <= 50; i += step) {
          if ((i + j + bottomPacks) * packCost <= budget3 && i + j > bestSumB) { bestSumB = i + j; p1_B = i; p2_B = j; }
        }
      }
      if (bestSumB === 0) { p1_B = bottomPacks; p2_B = bottomPacks; }

      const p1A_f = overrideP1_A !== '' ? Number(overrideP1_A) : p1_A;
      const p2A_f = overrideP2_A !== '' ? Number(overrideP2_A) : p2_A;
      const p3A_f = overrideP3_A !== '' ? Number(overrideP3_A) : bottomPacks;
      
      const p1B_f = overrideP1_B !== '' ? Number(overrideP1_B) : p1_B;
      const p2B_f = overrideP2_B !== '' ? Number(overrideP2_B) : p2_B;
      const p3B_f = overrideP3_B !== '' ? Number(overrideP3_B) : bottomPacks;

      return {
        winnerPacks2, loserPacks2, margin2: rev2 > 0 ? ((rev2 - cost2) / rev2) * 100 : 0, rev2, cost2,
        p1_A: p1A_f, p2_A: p2A_f, p3_A: p3A_f, margin3_A: rev3 > 0 ? ((rev3 - (p1A_f + p2A_f + p3A_f) * packCost) / rev3) * 100 : 0, rev3, cost3_A: (p1A_f + p2A_f + p3A_f) * packCost,
        p1_B: p1B_f, p2_B: p2B_f, p3_B: p3B_f, margin3_B: rev3 > 0 ? ((rev3 - (p1B_f + p2B_f + p3B_f) * packCost) / rev3) * 100 : 0, cost3_B: (p1B_f + p2B_f + p3B_f) * packCost,
        tiePacks_A: entryFee === 300 ? 3 : 2, tiePacks_B: entryFee === 300 ? 3 : 2
      };
    };

    let gymActiveRev = 0, gymActiveCost = 0, gymActiveMargin = 0, gymActiveSurplus = 0;
    if (isGym) {
      const p = currentPlayers >= 2 ? currentPlayers : 12;
      gymActiveRev = p * 300;
      let dist = getSwissWorstCaseDist(p, 3);
      if (p === 2) gymActiveCost = (7 + 1) * packCost;
      else if (p === 3) gymActiveCost = (9 + 3 + 1) * packCost;
      else gymActiveCost = (dist.top * 12 + dist.sub * 6 + dist.bot * 1) * packCost;
      gymActiveMargin = gymActiveRev > 0 ? ((gymActiveRev - gymActiveCost) / gymActiveRev) * 100 : 0;
      gymActiveSurplus = gymActiveRev - gymActiveCost - (gymActiveRev * (targetMargin/100));
    }

    const getCustomSpecStressTests = () => {
      const list = [
        { p: 2, label: '⚔️ 2人死鬥局 (1輪)', fee: fee2p, rounds: 1, type: 'p2' },
        { p: 3, label: '🔄 3人循環局 (3輪)', fee: fee3p, rounds: 3, type: 'p3' },
        { p: 4, label: '3輪常態 (4人)', fee: fee3r, rounds: 3, type: 'r3' },
        { p: 8, label: '3輪滿編 (8人)', fee: fee3r, rounds: 3, type: 'r3' },
        { p: 9, label: '⚠️ 4輪高壓 (9人)', fee: fee4r, rounds: 4, type: 'r4' },
        { p: 12, label: '4輪中堅 (12人)', fee: fee4r, rounds: 4, type: 'r4' },
        { p: 16, label: '4輪滿編 (16人)', fee: fee4r, rounds: 4, type: 'r4' },
        { p: 17, label: '⚠️ 5輪高壓 (17人)', fee: fee5r, rounds: 5, type: 'r5' },
        { p: 24, label: '5輪常態 (24人)', fee: fee5r, rounds: 5, type: 'r5' },
        { p: 25, label: '⚠️ 5輪高壓 (25人)', fee: fee5r, rounds: 5, type: 'r5' },
        { p: 32, label: '5輪滿編 (32人)', fee: fee5r, rounds: 5, type: 'r5' },
      ];

      return list.map(item => {
        const rev = item.p * item.fee;
        let cost = 0;
        if (item.type === 'p2') cost = customSpecData.p2.cost;
        else if (item.type === 'p3') cost = customSpecData.p3.cost;
        else {
          const dist = getSwissWorstCaseDist(item.p, item.rounds);
          const dataRef = customSpecData[item.type]; 
          const botMultiplier = dist.mid + dist.lowMid + dist.bot;
          if (dataRef.isPrizeMode) {
             cost = dataRef.prizeCost + (dist.sub * dataRef.sub + botMultiplier * bottomPacks) * packCost;
          } else {
             cost = (dist.top * dataRef.top + dist.sub * dataRef.sub + botMultiplier * bottomPacks) * packCost;
          }
        }
        return { p: item.p, label: item.label, fee: item.fee, totalCost: cost, margin: rev > 0 ? ((rev - cost) / rev) * 100 : 0, rev, isTarget: true };
      });
    };

    const getStressTestsList = () => {
      if (isCustomSpec) return getCustomSpecStressTests();
      return (isGym ? [2, 3, 4, 8, 9, 12, 16, 17, 20, 24, 28, 32, 33] : [4, 8, 9, 12, 16, 17, 20, 24, 25, 28, 32, 33]).map(p => {
        let cost = 0; let margin = 0; let label = "";
        if (isGym) {
          const rev = p * 300;
          let dist = getSwissWorstCaseDist(p, 3);
          if (p === 2) { cost = (7 + 1) * packCost; label = "2人對決 (1輪)"; } 
          else if (p === 3) {
            const emergencyData = getEmergencyStats();
            cost = (threePlayerMode === 'A' ? (emergencyData.p1_A + emergencyData.p2_A + emergencyData.p3_A) : (emergencyData.p1_B + emergencyData.p2_B + emergencyData.p3_B)) * packCost;
            label = "3人循環 (3輪)";
          } else {
            cost = (dist.top * 12 + dist.sub * 6 + dist.bot * 1) * packCost;
            label = [9, 17, 33].includes(p) ? `⚠️ ${p}人局 (3輪高壓輪空點)` : `${p}人常態賽 (3輪)`;
          }
          margin = rev > 0 ? ((rev - cost) / rev) * 100 : 0;
        } else {
          const R = matchRounds === 'auto' ? (p <= 8 ? 3 : p <= 16 ? 4 : 5) : Number(matchRounds) || 3;
          if (isSmooth) { const stats = getEventCostAndStats(p); cost = stats.totalCost; margin = stats.margin; } 
          else if (isGodMode) {
            const dist = getSwissWorstCaseDist(p, R);
            cost = dist.top * (godPrizeConfig[p] || godPrizeConfig[closestStandard(p)] || 0) + (dist.sub * finalGodSub + dist.mid * finalGodMid + dist.lowMid * (R === 4 ? finalGodMid : bottomPacks) + dist.bot * bottomPacks) * packCost;
            margin = ((p * entryFee - cost) / (p * entryFee)) * 100;
          } else {
            cost = p * fixedLotteryPacks * packCost + (lotteryPrizeConfig[p] || lotteryPrizeConfig[closestStandard(p)] || 0);
            margin = ((p * entryFee - cost) / (p * entryFee)) * 100;
          }
          label = [9, 17, 25, 33].includes(p) ? `⚠️ ${p}人局 (${R}輪高壓輪空點)` : `${p}人局 (${R}輪)`;
        }
        return { p, label, totalCost: cost, margin, isTarget: p >= 4 };
      });
    };

    const alertData = { hasAlert: false, type: null, data: [] };

    if (isSmooth || isCustomSpec) {
      const testList = isCustomSpec ? getCustomSpecStressTests() : [4, 8, 12, 16, 20, 24, 28, 32].map(p => ({ p, r: getEventCostAndStats(p) }));
      testList.forEach((item) => {
        const margin = isCustomSpec ? item.margin : item.r.margin;
        if (margin < targetMargin - 0.5) {
          alertData.data.push(isCustomSpec 
            ? { p: item.p, r: { R: item.label, margin, suggestedFee: item.fee + 50 }, label: item.label } 
            : item
          );
        }
      });
      if (alertData.data.length > 0) { alertData.hasAlert = true; alertData.type = 'smooth_low_margin'; }
    }

    return {
      isGym, isGodMode, isPureLottery, isSmooth, isCustomSpec, isPTCG,
      actualMidPacks, actualLowMidPacks, finalGodMid, finalGodSub,
      res4, res8, res12, res16, res20, res24, res28, res32,
      surplus8: getSurplusForPlayerCount(8), surplus16: getSurplusForPlayerCount(16), surplus24: getSurplusForPlayerCount(24), surplus32: getSurplusForPlayerCount(32),
      getEventCostAndStats, getEmergencyStats: getEmergencyStats(), stressTests: getStressTestsList(),
      gymActiveStats: { rev: gymActiveRev, cost: gymActiveCost, margin: gymActiveMargin, surplus: Math.max(0, gymActiveSurplus) },
      alertData, advice: { text: '目前配置極佳，利潤結構平穩安全。', color: 'text-slate-300' },
    };
  }, [
    entryFee, targetMargin, packCost, packPrice, bottomPacks, rewardModel, twoWinPolicy, champGap, topTax,
    godPrizeConfig, godMidPacks, godSubPacks, fixedLotteryPacks, lotteryPrizeConfig, selectedGame, matchRounds,
    currentPlayers, overrideWinner2, overrideLoser2, overrideP1_A, overrideP2_A, overrideP3_A, overrideP1_B, overrideP2_B, overrideP3_B,
    threePlayerMode, fee2p, fee3p, fee3r, fee4r, fee5r, customSpecData
  ]);

  const inputClass = 'w-full border border-slate-300 px-2 py-1.5 rounded bg-white text-slate-800 text-xs sm:text-sm font-semibold focus:ring-1 focus:ring-teal-500/50 outline-none transition-all truncate';
  const labelClass = 'block text-[11px] font-bold text-slate-500 mb-0.5 whitespace-nowrap';

  const reverseCalculatorSuggestions = useMemo(() => {
    const cost = Number(grandPrizeCost); const targetM = Number(grandPrizeMinMargin);
    if (isNaN(cost) || isNaN(targetM) || cost <= 0) return [];

    return [200, 250, 300, 400].map(fee => {
      const calcMin = (rounds, sc) => {
        const dist = getSwissWorstCaseDist(sc, rounds);
        const packsPerPlayer = (dist.sub * calculations.finalGodSub + dist.mid * calculations.finalGodMid + dist.lowMid * (rounds === 4 ? calculations.finalGodMid : bottomPacks) + dist.bot * bottomPacks) / sc;
        const denominator = fee * (1 - targetM / 100) - packsPerPlayer * packCost;
        return denominator <= 0 ? 999 : Math.max(sc, Math.ceil(cost / denominator));
      };
      const p3 = calcMin(3, 8); const p4 = calcMin(4, 16); const p5 = calcMin(5, 32);
      return { fee, p3, p4, p5 };
    });
  }, [grandPrizeCost, grandPrizeMinMargin, calculations.finalGodSub, calculations.finalGodMid, bottomPacks, packCost]);

  const renderStressTestRow = (t) => (
    <tr key={t.label} className="hover:bg-slate-100 transition-colors border-b border-slate-100/50 bg-white font-bold text-slate-800">
      <td className="py-2 px-3 text-left">
        <span className="text-xs">{t.label}</span>
        {Number(t.margin) >= targetMargin + 5 && <span className="ml-1.5 inline-block text-[10px] bg-emerald-100 text-emerald-800 px-1.5 py-0.2 rounded shadow-sm font-bold animate-pulse">利潤極佳 ✨</span>}
      </td>
      <td className="py-2 px-2 text-xs">${t.rev || t.p * entryFee}</td>
      <td className="py-2 px-2 text-xs text-rose-500">-${t.totalCost?.toFixed(0)}</td>
      <td className={`py-2 px-2 font-bold text-xs ${Number(t.margin) >= targetMargin ? 'text-teal-600' : 'text-rose-600'}`}>
        {Number(t.margin).toFixed(1)}%
      </td>
    </tr>
  );

  const getPTCGGuide = (rewardText) => {
    if (selectedGame !== 'ptcg') return '';
    const match = String(rewardText).match(/^(\d+)\s*包/);
    if (match) {
      const packs = parseInt(match[1], 10);
      if (packs % 3 === 0 && packs > 0) return `(可換 ${packs / 3} 包高級包)`;
    }
    return '';
  };

  const getTableCellValue = (rank, roundKey) => {
    const isSmooth = rewardModel === 'smooth';
    const isGod = rewardModel === 'god';
    const isLottery = rewardModel === 'pure-lottery';
    const { res8, res16, res24, res32 } = calculations;

    if (rank === '5勝') {
      if (roundKey === '3' || roundKey === '4') return '-';
      if (roundKey === '5_normal') return isSmooth ? `${res24.top || 0} 包` : isGod ? `$${godPrizeConfig[24] || 0}` : `${fixedLotteryPacks} 包`;
      if (roundKey === '5_special') return isSmooth ? `${res32.top || 0} 包` : isGod ? `$${godPrizeConfig[32] || 0}` : `${fixedLotteryPacks} 包`;
    }
    if (rank === '4勝') {
      if (roundKey === '3') return '-';
      if (roundKey === '4') return isSmooth ? `${res16.top || 0} 包` : isGod ? `$${godPrizeConfig[16] || 0}` : `${fixedLotteryPacks} 包`;
      if (roundKey === '5_normal') return isSmooth ? `${res24.sub || 0} 包` : isGod ? `${calculations.finalGodSub || 0} 包` : `${fixedLotteryPacks} 包`;
      if (roundKey === '5_special') return isSmooth ? `${res32.sub || 0} 包` : isGod ? `${calculations.finalGodSub || 0} 包` : `${fixedLotteryPacks} 包`;
    }
    if (rank === '3勝') {
      if (roundKey === '3') return isSmooth ? `${res8.top || 0} 包` : isGod ? `$${godPrizeConfig[8] || 0}` : `${fixedLotteryPacks} 包`;
      if (roundKey === '4') return isSmooth ? `${res16.sub || 0} 包` : isGod ? `${calculations.finalGodSub || 0} 包` : `${fixedLotteryPacks} 包`;
      if (roundKey === '5_normal') return isSmooth ? `${calculations.actualMidPacks || 0} 包` : isGod ? `${calculations.finalGodMid || 0} 包` : `${fixedLotteryPacks} 包`;
      if (roundKey === '5_special') return isSmooth ? `${calculations.actualMidPacks || 0} 包` : isGod ? `${calculations.finalGodMid || 0} 包` : `${fixedLotteryPacks} 包`;
    }
    if (rank === '2勝') {
      if (roundKey === '3') return isSmooth ? `${calculations.actualMidPacks || 0} 包` : isGod ? `${calculations.finalGodSub || 0} 包` : `${fixedLotteryPacks} 包`;
      if (roundKey === '4') return isSmooth ? `${calculations.actualLowMidPacks || 0} 包` : isGod ? `${calculations.finalGodMid || 0} 包` : `${fixedLotteryPacks} 包`;
      if (roundKey === '5_normal' || roundKey === '5_special') return isSmooth ? `${calculations.actualLowMidPacks || 0} 包` : isGod ? `${bottomPacks} 包` : `${fixedLotteryPacks} 包`;
    }
    if (rank === '1~0勝') return isLottery ? `${fixedLotteryPacks} 包` : `${bottomPacks} 包`;
    return '-';
  };

  const renderTableCell = (rank, roundKey) => {
    const val = getTableCellValue(rank, roundKey);
    if (val === '-') return <span className="text-slate-300">-</span>;

    const isGod = rewardModel === 'god';
    const isLottery = rewardModel === 'pure-lottery';
    const isCash = val.startsWith('$');
    let style = { text: 'text-slate-800', bg: 'bg-white' };

    if (isCash) style = { text: 'text-rose-700 text-sm sm:text-base font-black', bg: 'bg-rose-50 border border-rose-100/60 px-2 py-0.5 rounded shadow-sm' };
    else if (rank === '5勝') style = { text: 'text-amber-700 text-sm sm:text-base font-black', bg: 'bg-amber-50 border border-amber-200 px-2 py-0.5 rounded shadow-sm' };
    else if (rank === '4勝') style = { text: 'text-blue-700 text-sm sm:text-base font-bold', bg: 'bg-blue-50 border border-blue-150 px-2 py-0.5 rounded shadow-sm' };
    else if (rank === '3勝') style = { text: 'text-teal-700 font-bold', bg: 'bg-teal-50 border border-teal-100/80 px-1.5 py-0.5 rounded' };
    else if (rank === '2勝') style = { text: 'text-pink-600 font-semibold', bg: 'bg-pink-50 border border-pink-100/50 px-1.5 py-0.5 rounded' };
    else if (rank === '1~0勝') style = { text: 'text-slate-500 font-medium', bg: 'bg-slate-100 border border-slate-200/50 px-1.5 py-0.5 rounded' };

    return (
      <div className="flex flex-col items-center py-1">
        <span className={`${style.text} ${style.bg}`}>{val}</span>
        {getPTCGGuide(val) && <span className="text-xs text-slate-950 font-black mt-1 whitespace-nowrap">{getPTCGGuide(val).replace(/[()]/g, '')}</span>}
        {isCash && isGod && (
          <span className="text-[10px] text-rose-500 bg-rose-50 border border-rose-100/50 px-1 rounded-sm mt-0.5 whitespace-nowrap font-semibold scale-90">
            {roundKey === '5_normal' && rank === '5勝' && "24人滿編 (21~23人降級)"}
            {roundKey === '5_special' && rank === '5勝' && "32人滿編 (29~31人降級)"}
            {roundKey === '4' && rank === '4勝' && "16人滿編 (13~15人降級)"}
            {roundKey === '3' && rank === '3勝' && "8人滿編 (5~7人降級)"}
          </span>
        )}
        {isLottery && rank === '5勝' && <span className="text-xs text-slate-950 font-black mt-1 whitespace-nowrap">{roundKey === '5_normal' && `+ 抽獎 $${lotteryPrizeConfig[24] || 0}`}{roundKey === '5_special' && `+ 抽獎 $${lotteryPrizeConfig[32] || 0}`}</span>}
        {isLottery && rank === '4勝' && roundKey === '4' && <span className="text-xs text-slate-950 font-black mt-1 whitespace-nowrap font-medium">{`+ 抽獎 $${lotteryPrizeConfig[16] || 0}`}</span>}
        {isLottery && rank === '3勝' && roundKey === '3' && <span className="text-xs text-slate-950 font-black mt-1 whitespace-nowrap font-medium">{`+ 抽獎 $${lotteryPrizeConfig[8] || 0}`}</span>}
      </div>
    );
  };

  const singleRewards = useMemo(() => {
    let top = "-"; let sub = "-"; let mid = "-"; let lowMid = "-"; let bot = bottomPacks; let topLottery = ""; 
    const { res8, res16, res24, res32 } = calculations;

    if (rewardModel === 'smooth') {
      if (matchRounds === '3') { top = `${res8.top || 0} 包`; sub = `${selectedGame === 'ptcg' ? 3 : (calculations.actualLowMidPacks || 0)} 包`; } 
      else if (matchRounds === '4') { top = `${res16.top || 0} 包`; sub = `${res16.sub || 0} 包`; } 
      else if (matchRounds === '5') { top = `${res24.top || 0} 包`; sub = `${res24.sub || 0} 包`; mid = `${calculations.actualMidPacks || 0} 包`; }
    } else if (rewardModel === 'god') {
      if (matchRounds === '3') { top = `$${godPrizeConfig[8] || 0}`; sub = `${calculations.finalGodSub || 0} 包`; } 
      else if (matchRounds === '4') { top = `$${godPrizeConfig[16] || 0}`; sub = `${calculations.finalGodSub || 0} 包`; } 
      else if (matchRounds === '5') { top = `$${godPrizeConfig[24] || 0}`; sub = `${calculations.finalGodSub || 0} 包`; mid = `${calculations.finalGodMid || 0} 包`; }
    } else if (rewardModel === 'pure-lottery') {
      bot = fixedLotteryPacks; lowMid = `${fixedLotteryPacks} 包`; mid = `${fixedLotteryPacks} 包`; sub = `${fixedLotteryPacks} 包`; top = `${fixedLotteryPacks} 包`;
      if (matchRounds === '3') topLottery = `+ 抽獎 $${lotteryPrizeConfig[8] || 0}`;
      else if (matchRounds === '4') topLottery = `+ 抽獎 $${lotteryPrizeConfig[16] || 0}`;
      else if (matchRounds === '5') topLottery = `+ 抽獎 $${lotteryPrizeConfig[24] || 0}`;
    }
    return { top, sub, mid, lowMid, bot, topLottery };
  }, [rewardModel, matchRounds, calculations, bottomPacks, fixedLotteryPacks, lotteryPrizeConfig, godPrizeConfig, selectedGame]);

  const emergency = calculations.getEmergencyStats; 
  const showPlayersInput = rewardModel !== 'official-gym' && rewardModel !== 'custom-spec' && matchRounds !== 'auto';

  const renderModeToggle = (mode, setMode, theme) => (
    <div className="flex bg-slate-100 p-0.5 rounded-md mb-2 mt-1">
      <button onClick={() => setMode('pack')} className={`flex-1 text-[10px] font-bold py-1 rounded transition-colors ${mode === 'pack' ? 'bg-white shadow-sm text-slate-800' : 'text-slate-400 hover:text-slate-600'}`}>⚡ 補充包</button>
      <button onClick={() => setMode('prize')} className={`flex-1 text-[10px] font-bold py-1 rounded transition-colors ${mode === 'prize' ? `bg-white shadow-sm text-${theme}-600` : 'text-slate-400 hover:text-slate-600'}`}>🎁 實體大獎</button>
    </div>
  );

  return (
    <div className="min-h-screen lg:h-screen w-full bg-slate-100 p-2.5 flex flex-col gap-2.5 font-sans text-slate-800 overflow-y-auto lg:overflow-hidden box-border">
      <style>{`.hide-scrollbar::-webkit-scrollbar { display: none; } .hide-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }`}</style>

      {/* 標頭 Header */}
      <div className={`shrink-0 px-4 py-2.5 rounded-lg shadow-sm flex flex-col sm:flex-row justify-between items-start sm:items-center text-white gap-3 sm:gap-0 transition-colors duration-500 ${rewardModel === 'official-gym' ? 'bg-indigo-800' : rewardModel === 'custom-spec' ? 'bg-indigo-950' : calculations.isSmooth ? 'bg-teal-700' : calculations.isGodMode ? 'bg-rose-800' : 'bg-pink-600'}`}>
        <div className="flex items-baseline gap-3">
          <h1 className="text-xl font-bold tracking-wider whitespace-nowrap">怪獸造咔 🦖 v9.9.11</h1>
          <span className="text-white/80 text-xs hidden sm:inline-block">
            {rewardModel === 'official-gym' ? '🔵 方案四：寶可夢官方道館賽 (固定3輪里程碑)' : rewardModel === 'custom-spec' ? '🏆 方案五：怪獸雙軌規格賽 (全景自訂定價手冊)' : calculations.isSmooth ? '🟢 方案一：日常平滑 (勝場發包)' : calculations.isGodMode ? '🔴 方案二：旗艦大賽 (冠軍高額獎金 + 智慧自訂逆推)' : '💖 方案三：同樂樂透 (保底+大抽獎)'}
          </span>
        </div>
        
        <div className="flex items-center gap-4 w-full sm:w-auto justify-between sm:justify-end">
          <div className="flex items-center gap-1 bg-white/10 backdrop-blur-sm p-1 rounded-md border border-white/10 text-xs shadow-inner">
            <span className="opacity-80 px-1 select-none">🔍 字型縮放:</span>
            <button onClick={() => setZoomLevel(Math.max(85, zoomLevel - 10))} className="w-6 h-6 rounded bg-white/20 hover:bg-white/30 text-white font-extrabold flex items-center justify-center active:scale-95">-</button>
            <span className="font-bold w-12 text-center select-none text-white">{zoomLevel}%</span>
            <button onClick={() => setZoomLevel(Math.min(145, zoomLevel + 10))} className="w-6 h-6 rounded bg-white/20 hover:bg-white/30 text-white font-extrabold flex items-center justify-center active:scale-95">+</button>
            {zoomLevel !== 100 && <button onClick={() => setZoomLevel(100)} className="text-[10px] bg-white/30 hover:bg-white/40 px-1.5 py-0.5 rounded leading-none text-white font-medium">重設</button>}
          </div>

          <div className="text-right whitespace-nowrap leading-none shrink-0">
            {rewardModel === 'custom-spec' ? <div className="bg-white/20 text-white px-2 py-1 rounded text-xs font-black border border-white/30 tracking-widest mt-1">獨立手冊模式</div> : <><span className="text-[10px] opacity-80 block leading-none mb-0.5">預設報名費</span><span className="text-xl font-bold leading-none">${entryFee}</span></>}
          </div>
        </div>
      </div>

      {/* 控制面板 */}
      <div className="shrink-0 bg-white p-3 rounded-lg shadow-sm border border-slate-200 flex flex-col gap-2.5">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 items-end">
          <div className="lg:col-span-3 w-full">
            <label className={labelClass}>🏆 賽事產品線</label>
            <select value={rewardModel} onChange={(e) => setRewardModel(e.target.value)} className={`w-full p-1.5 rounded-md border-2 text-xs font-bold focus:outline-none transition-all ${rewardModel === 'official-gym' ? 'border-indigo-400 bg-indigo-50 text-indigo-950' : rewardModel === 'custom-spec' ? 'border-indigo-600 bg-indigo-950/5 text-indigo-950' : calculations.isSmooth ? 'border-teal-300 bg-teal-50 text-teal-900' : calculations.isGodMode ? 'border-rose-300 bg-rose-50 text-rose-900' : 'border-pink-300 bg-pink-50 text-pink-900'}`}>
              <option value="smooth">🟢 方案一：日常平滑 (勝場發包)</option>
              <option value="god">🔴 方案二：旗艦大賽 (冠軍降級領獎)</option>
              <option value="pure-lottery">💖 方案三：同樂樂透 (滿編大抽獎)</option>
              <option value="official-gym">🔵 方案四：寶可夢官方道館賽 (3輪里程碑)</option>
              <option value="custom-spec">🏆 方案五：怪獸雙軌規格賽 (定價自訂手冊)</option>
            </select>
          </div>

          <div className="lg:col-span-9 grid grid-cols-2 sm:grid-cols-6 lg:grid-cols-12 gap-2 w-full">
            <div className="col-span-2">
              <label className={labelClass}>遊戲</label>
              <select value={selectedGame} onChange={handleGameChange} className={`${inputClass} ${rewardModel === 'official-gym' ? 'bg-slate-100 text-slate-500 cursor-not-allowed' : ''}`} disabled={rewardModel === 'official-gym'}>
                {Object.entries(GAME_DATABASE).map(([id, game]) => <option key={id} value={id}>{game.name}</option>)}
              </select>
            </div>
            <div className="col-span-2">
              <label className={labelClass}>預設包價</label>
              <select value={selectedGame === 'ptcg' ? 0 : selectedPackIndex} onChange={handlePackChange} className={`${inputClass} ${(selectedGame === 'ptcg' || rewardModel === 'official-gym') ? 'bg-slate-100 text-slate-500 cursor-not-allowed' : ''}`} disabled={selectedGame === 'ptcg' || rewardModel === 'official-gym'}>
                {GAME_DATABASE[selectedGame].packs.map((p, i) => <option key={i} value={i}>{p.label}</option>)}
              </select>
            </div>
            
            <div className="col-span-2">
              <label className={`${labelClass} text-indigo-600 font-extrabold`}>⏱️ 對戰輪數</label>
              <select value={matchRounds} onChange={(e) => setMatchRounds(e.target.value)} className={`${inputClass} border-indigo-300 font-extrabold ${rewardModel === 'official-gym' ? 'bg-slate-100 text-slate-500 cursor-not-allowed' : 'bg-indigo-50/30 text-indigo-900'}`} disabled={rewardModel === 'official-gym'}>
                <option value="auto">⏱️ 自動 (依人數開賽)</option>
                <option value="3">⏱️ 固定 3 輪</option>
                <option value="4">⏱️ 固定 4 輪</option>
                <option value="5">⏱️ 固定 5 輪</option>
              </select>
            </div>

            <div className="col-span-1">
              <label className={labelClass}>成本($)</label>
              <input type="number" step="0.01" min="0" value={packCost} onChange={(e) => setPackCost(Number(e.target.value))} className={`${inputClass} text-rose-700 bg-rose-50/40`} disabled={rewardModel === 'official-gym'} />
            </div>
            <div className="col-span-1">
              <label className={labelClass}>售價($)</label>
              <input type="number" step="1" min="1" value={packPrice} onChange={(e) => setPackPrice(Number(e.target.value))} className={`${inputClass} text-teal-700 bg-teal-50/40`} disabled={rewardModel === 'official-gym'} />
            </div>
            
            {rewardModel === 'custom-spec' ? (
              <div className="col-span-1 bg-indigo-950/10 rounded px-1.5 py-0.5 border border-indigo-950/20 text-center flex flex-col justify-center h-full select-none animate-in fade-in">
                <span className="text-[9px] font-black text-indigo-900 leading-none mb-0.5">🔒 獨立自訂</span>
                <span className="text-xs font-black text-indigo-950 leading-none">全景手冊</span>
              </div>
            ) : (
              <div className="col-span-1">
                <label className={labelClass}>預設報名費</label>
                <input type="number" step="50" value={entryFee} onChange={(e) => setEntryFee(Number(e.target.value))} className={inputClass} disabled={rewardModel === 'official-gym'} />
              </div>
            )}

            <div className="col-span-1">
              <label className={labelClass}>目標毛利(%)</label>
              <input type="number" value={targetMargin} onChange={(e) => setTargetMargin(Number(e.target.value))} className={`${inputClass} text-blue-700 bg-blue-50/50`} />
            </div>
            <div className="col-span-1">
              <label className={labelClass}>底線(%)</label>
              <input type="number" value={minMargin} onChange={(e) => setMinMargin(Number(e.target.value))} className={`${inputClass} text-rose-700 bg-rose-50/50`} />
            </div>
            
            {rewardModel === 'official-gym' ? (
              <div className="col-span-1 bg-indigo-50 rounded px-1.5 py-0.5 border border-indigo-200 text-center flex flex-col justify-center h-full select-none animate-in fade-in"><span className="text-[9px] font-black text-indigo-800 leading-none mb-0.5">🔒 官方規格</span><span className="text-xs font-black text-indigo-950 leading-none">強鎖 3 輪</span></div>
            ) : rewardModel === 'custom-spec' ? (
              <div className="col-span-1 bg-indigo-950/10 rounded px-1.5 py-0.5 border border-indigo-950/20 text-center flex flex-col justify-center h-full select-none animate-in fade-in"><span className="text-[9px] font-black text-indigo-900 leading-none mb-0.5">🏆 雙軌規格賽</span><span className="text-xs font-black text-indigo-950 leading-none">全景定價</span></div>
            ) : showPlayersInput ? (
              <div className="col-span-1 bg-amber-50 rounded px-1.5 py-0.5 border border-amber-200 animate-in fade-in"><label className="block text-[10px] font-black text-amber-800 leading-none mb-1">👥 當前人數</label><input type="number" min="2" max="100" value={currentPlayers} onChange={(e) => setCurrentPlayers(Math.max(2, Number(e.target.value)))} className="w-full text-center border border-amber-300 rounded bg-white text-slate-800 text-xs sm:text-sm font-black p-0.5 focus:ring-1 focus:ring-amber-500" /></div>
            ) : (
              <div className="col-span-1 bg-teal-50 rounded px-1.5 py-0.5 border border-teal-200 animate-in fade-in"><label className="block text-[10px] font-black text-teal-800 leading-none mb-1">🛡️ 最低保底</label><input type="number" min="1" value={bottomPacks} onChange={(e) => setBottomPacks(Math.max(1, Number(e.target.value)))} className="w-full text-center border border-teal-300 rounded bg-white text-slate-800 text-xs sm:text-sm font-black p-0.5 focus:ring-1 focus:ring-teal-500" /></div>
            )}
          </div>
        </div>

        {calculations.isSmooth && (
          <div className="bg-teal-50/50 px-3 py-1.5 rounded-md border border-teal-100 flex flex-wrap items-center gap-x-4 gap-y-2">
            <div className="flex items-center gap-2"><span className="text-xs sm:text-sm font-bold text-teal-800 whitespace-nowrap">2勝政策:</span><select value={twoWinPolicy} onChange={(e) => setTwoWinPolicy(e.target.value)} className={`${inputClass} w-24 sm:w-28 py-1 text-xs`}><option value="half">半血回本</option><option value="bottom">併入保底</option></select></div><div className="h-4 w-px bg-teal-200 hidden sm:block"></div>
            <div className="flex items-center gap-2"><span className="text-xs sm:text-sm font-bold text-teal-800 whitespace-nowrap">落差:</span><select value={champGap} onChange={(e) => setChampGap(Number(e.target.value))} className={`${inputClass} w-20 py-1 text-xs`}><option value={1}>1 包</option><option value={2}>2 包</option></select></div><div className="h-4 w-px bg-teal-200 hidden sm:block"></div>
            <div className="flex items-center gap-2"><span className="text-xs sm:text-sm font-bold text-teal-800 whitespace-nowrap">提撥轉餘額:</span><select value={topTax} onChange={(e) => setTopTax(Number(e.target.value))} className={`${inputClass} w-36 py-1 text-xs`}><option value={0}>0包 (不扣留)</option><option value={1}>-1包 (小額備用)</option><option value={2}>-2包 (擴大備用)</option></select></div>
          </div>
        )}

        {/* V9.9.11 方案二：大賽成本逆推自訂計算機與一鍵實戰模組 */}
        {calculations.isGodMode && (
          <div className="bg-rose-50/50 px-3 py-1.5 rounded-md border border-rose-100 flex flex-col gap-2.5">
            <div className="bg-white p-3 rounded-lg border border-rose-200 shadow-sm flex flex-col xl:flex-row gap-4 items-center justify-between">
              <div className="flex flex-wrap items-center gap-3 w-full xl:w-auto">
                <span className="text-sm font-black text-rose-950 flex items-center gap-1.5 shrink-0 select-none"><span className="text-lg">🤖</span><span>大賽成本逆推自訂計算機</span></span>
                <div className="flex items-center gap-1"><span className="text-xs font-semibold text-slate-500">冠軍大獎死成本:</span><input type="number" step="100" value={grandPrizeCost} onChange={(e) => setGrandPrizeCost(Math.max(0, Number(e.target.value)))} className="w-20 text-center border border-rose-300 bg-rose-50/20 rounded p-1 text-xs sm:text-sm font-black text-rose-700" /><span className="text-xs font-semibold text-slate-500">元</span></div>
                <div className="flex items-center gap-1"><span className="text-xs font-semibold text-slate-500">最低毛利底線:</span><input type="number" value={grandPrizeMinMargin} onChange={(e) => setGrandPrizeMinMargin(Math.max(0, Math.min(99, Number(e.target.value))))} className="w-14 text-center border border-rose-300 bg-rose-50/20 rounded p-1 text-xs sm:text-sm font-black text-rose-700" /><span className="text-xs font-semibold text-slate-500">%</span></div>
              </div>
              <div className="flex flex-wrap gap-2 w-full xl:w-auto justify-end">
                {reverseCalculatorSuggestions.map(s => (
                  <div key={s.fee} className="bg-rose-50/30 border border-rose-100 rounded p-1.5 text-center min-w-[150px] shadow-sm">
                    <span className="block text-xs font-black text-rose-900 leading-none mb-1 border-b border-rose-100/50 pb-1">🎫 門票 ${s.fee} 時</span>
                    <div className="flex flex-col gap-1 text-[10px] sm:text-xs">
                      <div className="flex justify-between items-center bg-white px-1 py-0.5 rounded border border-rose-50"><span className="font-semibold text-slate-600">3輪: <b className="text-rose-700">{s.p3 > 100 ? "無法回本" : `${s.p3}人`}</b></span>{s.p3 <= 100 && <button onClick={() => applyReverseConfig(s.fee, s.p3)} className="bg-rose-600 hover:bg-rose-700 text-white text-[9px] px-1.5 py-0.5 rounded transition-colors">套用</button>}</div>
                      <div className="flex justify-between items-center bg-white px-1 py-0.5 rounded border border-rose-50"><span className="font-semibold text-slate-600">4輪: <b className="text-rose-700">{s.p4 > 100 ? "無法回本" : `${s.p4}人`}</b></span>{s.p4 <= 100 && <button onClick={() => applyReverseConfig(s.fee, s.p4)} className="bg-rose-600 hover:bg-rose-700 text-white text-[9px] px-1.5 py-0.5 rounded transition-colors">套用</button>}</div>
                      <div className="flex justify-between items-center bg-white px-1 py-0.5 rounded border border-rose-50"><span className="font-semibold text-slate-600">5輪: <b className="text-rose-700">{s.p5 > 100 ? "無法回本" : `${s.p5}人`}</b></span>{s.p5 <= 100 && <button onClick={() => applyReverseConfig(s.fee, s.p5)} className="bg-rose-600 hover:bg-rose-700 text-white text-[9px] px-1.5 py-0.5 rounded transition-colors">套用</button>}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-rose-50/60 p-3 rounded-lg border border-rose-100 mt-1">
              <div className="flex items-center gap-2 mb-2 border-b border-rose-100 pb-1">
                <span className="text-sm font-black text-rose-900">💡 系統推薦大賽模組 (一鍵自動帶入參數)：</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
                <button onClick={() => applyPresetEvent(400, 4, 16)} className="bg-white border border-rose-200 hover:border-rose-400 hover:shadow-md p-2 rounded-lg text-left transition-all group">
                  <span className="block text-xs font-bold text-rose-700 group-hover:text-rose-800">🚀 載入 16 人：高保底大賽模組</span>
                  <span className="block text-[10px] text-slate-500 mt-1">門票 $400 / 保底 4 包 / 冠軍發 ${grandPrizeCost}</span>
                </button>
                <button onClick={() => applyPresetEvent(250, 1, 24)} className="bg-white border border-rose-200 hover:border-rose-400 hover:shadow-md p-2 rounded-lg text-left transition-all group">
                  <span className="block text-xs font-bold text-rose-700 group-hover:text-rose-800">🚀 載入 24 人：中階挑戰賽模組</span>
                  <span className="block text-[10px] text-slate-500 mt-1">門票 $250 / 保底 1 包 / 冠軍發 ${grandPrizeCost}</span>
                </button>
                <button onClick={() => applyPresetEvent(200, 1, 32)} className="bg-white border border-rose-200 hover:border-rose-400 hover:shadow-md p-2 rounded-lg text-left transition-all group">
                  <span className="block text-xs font-bold text-rose-700 group-hover:text-rose-800">🚀 載入 32 人：滿編爭霸賽模組</span>
                  <span className="block text-[10px] text-slate-500 mt-1">門票 $200 / 保底 1 包 / 冠軍發 ${grandPrizeCost}</span>
                </button>
                <button onClick={resetGodMode} className="bg-slate-100 border border-slate-300 hover:bg-slate-200 hover:shadow-md p-2 rounded-lg text-left transition-all">
                  <span className="block text-xs font-bold text-slate-700">🔄 清除大獎，恢復預設狀態</span>
                  <span className="block text-[10px] text-slate-500 mt-1">清空特別獎金，回歸日常門票</span>
                </button>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-x-6 gap-y-2.5 mt-2">
              <div className="flex flex-wrap gap-x-3 gap-y-1 items-center flex-1 min-w-[280px]">
                <span className="text-xs font-bold text-rose-950 whitespace-nowrap">🏆 滿編大獎 ($):</span>
                <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2 flex-1">
                  {[4, 8, 12, 16, 20, 24, 28, 32].map((p) => {
                    const limit = Math.floor(p === 4 ? calculations.res4.maxChampBudget : p === 8 ? calculations.res8.maxChampBudget : p === 12 ? calculations.res12.maxChampBudget : p === 16 ? calculations.res16.maxChampBudget : p === 20 ? calculations.res20.maxChampBudget : p === 24 ? calculations.res24.maxChampBudget : p === 28 ? calculations.res28.maxChampBudget : calculations.res32.maxChampBudget);
                    return (
                      <div key={p} className="min-w-[65px] flex flex-col justify-end">
                        <div className="flex items-baseline justify-between w-full mb-1 text-[clamp(0.68rem,0.9vw,0.85rem)] leading-none whitespace-nowrap gap-1"><span className="text-rose-900 font-extrabold shrink-0">{p}人</span><span className="text-rose-500 font-bold truncate">上限:${limit}</span></div>
                        <input type="number" step="50" value={godPrizeConfig[p] || ''} onChange={(e) => setGodPrizeConfig(prev => ({ ...prev, [p]: Number(e.target.value) }))} className={`${inputClass} text-center text-rose-700 py-0.5 text-xs font-bold`} />
                      </div>
                    );
                  })}
                </div>
              </div>
              <div className="flex gap-3 items-center border-t sm:border-t-0 sm:border-l border-rose-200 pt-1.5 sm:pt-0 sm:pl-6">
                <span className="text-xs sm:text-sm font-bold text-rose-950 whitespace-nowrap">🔪 陪榜包數:</span>
                <div className="flex gap-2">
                  <div className="w-14"><span className="text-[0.68rem] font-bold text-rose-600 block text-center leading-none mb-0.5">X-2 中堅</span><input type="number" min={bottomPacks} value={godMidPacks} onChange={(e) => setGodMidPacks(Number(e.target.value))} className={`${inputClass} text-center py-0.5 text-xs`} /></div>
                  <div className="w-14"><span className="text-[0.68rem] font-bold text-rose-600 block text-center leading-none mb-0.5">X-1 亞軍</span><input type="number" min={godMidPacks} value={godSubPacks} onChange={(e) => setGodSubPacks(Number(e.target.value))} className={`${inputClass} text-center py-0.5 text-xs`} /></div>
                </div>
              </div>
            </div>
          </div>
        )}

        {calculations.isPureLottery && (
          <div className="bg-pink-50/50 px-3 py-1.5 rounded-md border border-pink-100 flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2 bg-white px-3 py-1 rounded border border-pink-100 shadow-inner text-[0.68rem] sm:text-xs">
              <span className="font-extrabold text-pink-900 mr-1 flex items-center gap-1 shrink-0"><span>⚡</span> 等差智慧產生器:</span>
              <span className="text-slate-400 font-medium">設定</span><select value={lotteryHelperA} onChange={(e) => setLotteryHelperA(Number(e.target.value))} className="border border-slate-200 rounded px-1 py-0.5 font-bold text-slate-700 bg-slate-50">{[8,12,16,20,24,28,32].map(n => <option key={n} value={n}>{n}人</option>)}</select>
              <span className="text-slate-400 font-medium">為 $</span><input type="number" step="50" value={lotteryHelperValA} onChange={(e) => setLotteryHelperValA(Number(e.target.value))} className="w-16 border border-slate-200 rounded px-1 py-0.5 text-center font-bold text-pink-700 bg-pink-50/30" />
              <span className="text-slate-400 font-medium">且</span><select value={lotteryHelperB} onChange={(e) => setLotteryHelperB(Number(e.target.value))} className="border border-slate-200 rounded px-1 py-0.5 font-bold text-slate-700 bg-slate-50">{[8,12,16,20,24,28,32].map(n => <option key={n} value={n}>{n}人</option>)}</select>
              <span className="text-slate-400 font-medium">為 $</span><input type="number" step="50" value={lotteryHelperValB} onChange={(e) => setLotteryHelperValB(Number(e.target.value))} className="w-16 border border-slate-200 rounded px-1 py-0.5 text-center font-bold text-pink-700 bg-pink-50/30" />
              <button onClick={() => applyLinearTrend('lottery', lotteryHelperA, lotteryHelperValA, lotteryHelperB, lotteryHelperValB)} className="bg-pink-700 hover:bg-pink-800 text-white font-bold px-2 py-0.5 rounded shadow-sm transition-colors cursor-pointer ml-auto">👉 立即生成等差預算</button>
            </div>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
              <div className="flex items-center gap-2"><span className="text-xs sm:text-sm font-bold text-pink-900 whitespace-nowrap">全體保底參加獎:</span><input type="number" min="1" value={fixedLotteryPacks} onChange={(e) => setFixedLotteryPacks(Number(e.target.value))} className={`${inputClass} w-14 py-0.5 text-center text-xs`} /></div>
              <div className="flex-1 flex flex-wrap gap-x-3 gap-y-1 items-center border-t xl:border-t-0 xl:border-l border-pink-200 pt-1.5 xl:pt-0 xl:pl-6 min-w-[240px]">
                <span className="text-xs sm:text-sm font-bold text-pink-950 whitespace-nowrap">🎁 達標樂透池 ($):</span>
                <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2 flex-1">
                  {[8, 12, 16, 20, 24, 28, 32].map((p) => {
                    const limit = Math.floor((p * entryFee) * (1 - targetMargin / 100) - (p * fixedLotteryPacks * packCost));
                    return (
                      <div key={p} className="min-w-[60px] flex flex-col justify-end">
                        <div className="flex items-baseline justify-between w-full mb-1 text-[clamp(0.68rem,0.9vw,0.85rem)] leading-none whitespace-nowrap gap-1"><span className="text-[10px] text-pink-800 block font-bold leading-none">{p === 32 ? '32人' : `${p}人`}</span><span className="text-pink-500 font-bold truncate">上限:${Math.max(0, limit)}</span></div>
                        <input type="number" step="50" value={lotteryPrizeConfig[p] || ''} onChange={(e) => setLotteryPrizeConfig(prev => ({ ...prev, [p]: Number(e.target.value) }))} className={`${inputClass} text-center text-pink-700 py-0.5 text-xs font-bold`} />
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="flex-1 min-h-0 flex flex-col lg:flex-row gap-2.5">
        <div className="flex-[3] flex flex-col gap-2.5 min-w-0 min-h-0">
          
          {rewardModel === 'custom-spec' ? (
            <div className="flex-1 overflow-hidden bg-slate-50/20 p-3 rounded-lg border border-slate-200 flex flex-col gap-3">
              <div className="bg-indigo-950 text-white rounded-lg p-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 sm:gap-0 shadow-md shrink-0">
                <div>
                  <h2 className="text-lg font-black flex items-center gap-2 select-none"><span>🏆</span><span>怪獸雙軌規格賽 (全景自適應定價手冊)</span></h2>
                  <p className="text-[11px] text-white/80 font-semibold mt-1">店長！此模式允許為五大常用賽制單獨微調報名費，系統將自動套用 <b>1.5倍強等差</b> 確保冠軍體感，並死守 <b>{targetMargin}% 目標毛利</b> 防線！</p>
                </div>
                <div className="bg-white/10 backdrop-blur border border-white/20 px-3 py-1.5 rounded-lg text-center shrink-0">
                  <span className="text-[10px] block opacity-80 leading-none">全球統一保底</span><span className="text-base font-black leading-none">{bottomPacks} 包</span>
                </div>
              </div>

              {/* V9.9.8 全景響應式網格 (不再出現捲軸) */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3 flex-1 items-start overflow-y-auto pr-1">
                
                {/* 1. 雙人死鬥死決 */}
                <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-3.5 flex flex-col hover:shadow transition-shadow">
                  <div className="flex justify-between items-center border-b border-slate-100 pb-2 mb-2">
                    <span className="font-black text-sm text-slate-800 flex items-center gap-1"><span className="text-lg">⚔️</span> 2人死鬥賽</span>
                    <span className="text-[10px] bg-rose-50 border border-rose-200 text-rose-800 font-extrabold px-1.5 py-0.5 rounded-full">突發局</span>
                  </div>
                  <FeeController value={fee2p} onChange={setFee2p} theme="rose" />
                  <div className="space-y-2.5 text-xs sm:text-sm flex-1 mt-1">
                    <div className="flex justify-between items-center bg-amber-50/50 p-2 rounded border border-amber-100">
                      <span className="font-bold text-slate-700">🥇 1勝0敗：</span>
                      <div className="text-right">
                        <span className="font-black text-amber-700 text-sm">{customSpecData.p2.w} 包</span>
                        {getPTCGGuide(customSpecData.p2.w + " 包") && <span className="text-[10px] text-slate-950 font-black block leading-none mt-0.5">{getPTCGGuide(customSpecData.p2.w + " 包").replace(/[()]/g, '')}</span>}
                        <div className="text-[9px] text-slate-400 font-bold mt-1">(成本: ${customSpecData.p2.topCost?.toFixed(0)} / 售價: ${customSpecData.p2.topValue?.toFixed(0)})</div>
                      </div>
                    </div>
                    <div className="flex justify-between items-center bg-slate-50 p-2 rounded border border-slate-200/60">
                      <span className="font-medium text-slate-500">🥈 0勝1敗：</span><span className="font-bold text-slate-600">{bottomPacks} 包 (保底)</span>
                    </div>
                  </div>
                </div>

                {/* 2. 三人循環賽 */}
                <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-3.5 flex flex-col hover:shadow transition-shadow">
                  <div className="flex justify-between items-center border-b border-slate-100 pb-2 mb-2">
                    <span className="font-black text-sm text-slate-800 flex items-center gap-1"><span className="text-lg">🔄</span> 3人循環賽</span>
                    <span className="text-[10px] bg-teal-50 border border-teal-200 text-teal-800 font-extrabold px-1.5 py-0.5 rounded-full">突發局</span>
                  </div>

                  <FeeController value={fee3p} onChange={setFee3p} theme="teal" />

                  <div className="space-y-2.5 text-xs sm:text-sm flex-1 mt-1">
                    <div className="flex justify-between items-center bg-amber-50/50 p-2 rounded border border-amber-100">
                      <span className="font-bold text-slate-700">🥇 2勝0敗：</span>
                      <div className="text-right">
                        <span className="font-black text-amber-700 text-sm">{customSpecData.p3.p1} 包</span>
                        {getPTCGGuide(customSpecData.p3.p1 + " 包") && <span className="text-[10px] text-slate-950 font-black block leading-none mt-0.5">{getPTCGGuide(customSpecData.p3.p1 + " 包").replace(/[()]/g, '')}</span>}
                        <div className="text-[9px] text-slate-400 font-bold mt-1">(成本: ${customSpecData.p3.topCost?.toFixed(0)} / 售價: ${customSpecData.p3.topValue?.toFixed(0)})</div>
                      </div>
                    </div>
                    <div className="flex justify-between items-center bg-blue-50/50 p-2 rounded border border-blue-100">
                      <span className="font-bold text-slate-700">🥈 1勝1敗：</span>
                      <div className="text-right">
                        <span className="font-bold text-blue-700 text-sm">{customSpecData.p3.p2} 包</span>
                        {getPTCGGuide(customSpecData.p3.p2 + " 包") && <span className="text-[10px] text-slate-950 font-black block leading-none mt-0.5">{getPTCGGuide(customSpecData.p3.p2 + " 包").replace(/[()]/g, '')}</span>}
                      </div>
                    </div>
                    <div className="flex justify-between items-center bg-slate-50 p-2 rounded border border-slate-200/60">
                      <span className="font-medium text-slate-500">🥉 0勝2敗：</span><span className="font-bold text-slate-600">{bottomPacks} 包 (保底)</span>
                    </div>
                  </div>
                </div>

                {/* 3. 三輪日常瑞士 (新增實體大獎切換) */}
                <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-3.5 flex flex-col hover:shadow transition-shadow">
                  <div className="flex justify-between items-center border-b border-slate-100 pb-2 mb-0">
                    <span className="font-black text-sm text-slate-800 flex items-center gap-1"><span className="text-lg">⏱️</span> 3輪日常賽</span>
                    <span className="text-[10px] bg-emerald-50 border border-emerald-200 text-emerald-800 font-extrabold px-1.5 py-0.5 rounded-full">4~8人</span>
                  </div>
                  {renderModeToggle(r3Mode, setR3Mode, 'emerald')}
                  <FeeController value={fee3r} onChange={setFee3r} theme="emerald" />
                  <div className="space-y-2.5 text-xs sm:text-sm flex-1 mt-1">
                    {(() => {
                      const data = customSpecData.r3;
                      return data.isPrizeMode ? (
                        <>
                          <div className="flex justify-between items-center bg-amber-50/50 p-2 rounded border border-amber-100">
                             <span className="font-bold text-slate-700">🥇 冠軍大獎：</span>
                             <div className="flex items-center gap-1">
                               <span className="text-xs font-bold text-slate-500">$</span>
                               <input type="number" value={r3PrizeCost} onChange={(e)=>setR3PrizeCost(Math.max(0, Number(e.target.value)))} className="w-16 text-center text-xs font-bold border border-amber-300 rounded p-0.5 text-amber-700 focus:outline-amber-500" />
                             </div>
                          </div>
                          <div className="mt-2 text-[11px] bg-slate-50 text-slate-700 p-2 rounded font-bold text-center border border-slate-200 shadow-sm">
                             {data.minPlayers > 100 ? (
                               <span className="text-rose-600">此報名費無法回本，請調高！</span>
                             ) : (
                               <>滿 <span className="text-emerald-600 text-sm">{data.minPlayers} 人</span> 開賽 ➔ 毛利 {data.margin.toFixed(1)}%</>
                             )}
                          </div>
                          <div className="flex justify-between items-center bg-blue-50/50 p-2 rounded border border-blue-100 mt-2">
                            <span className="font-bold text-slate-700">🥈 2 勝 1 敗：</span><div className="text-right"><span className="font-bold text-blue-700 text-sm">{data.sub} 包</span></div>
                          </div>
                          <div className="flex justify-between items-center bg-slate-50 p-2 rounded border border-slate-200/60">
                            <span className="font-medium text-slate-500">🛡️ 1~0 勝：</span><span className="font-bold text-slate-600">{data.bot} 包</span>
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="flex justify-between items-center bg-amber-50/50 p-2 rounded border border-amber-100">
                            <span className="font-bold text-slate-700">🥇 3 勝 0 敗：</span>
                            <div className="text-right">
                              <span className="font-black text-amber-700 text-sm">{data.top} 包</span>
                              {getPTCGGuide(data.top + " 包") && <span className="text-[10px] text-slate-950 font-black block leading-none mt-0.5">{getPTCGGuide(data.top + " 包").replace(/[()]/g, '')}</span>}
                              <div className="text-[9px] text-slate-400 font-bold mt-1">(成本: ${data.topCost?.toFixed(0)} / 售價: ${data.topValue?.toFixed(0)})</div>
                            </div>
                          </div>
                          <div className="flex justify-between items-center bg-blue-50/50 p-2 rounded border border-blue-100">
                            <span className="font-bold text-slate-700">🥈 2 勝 1 敗：</span>
                            <div className="text-right"><span className="font-bold text-blue-700 text-sm">{data.sub} 包</span>{getPTCGGuide(data.sub + " 包") && <span className="text-[10px] text-slate-950 font-black block leading-none mt-0.5">{getPTCGGuide(data.sub + " 包").replace(/[()]/g, '')}</span>}</div>
                          </div>
                          <div className="flex justify-between items-center bg-slate-50 p-2 rounded border border-slate-200/60">
                            <span className="font-medium text-slate-500">🛡️ 1~0 勝：</span><span className="font-bold text-slate-600">{data.bot} 包</span>
                          </div>
                        </>
                      )
                    })()}
                  </div>
                </div>

                {/* 4. 四輪挑戰賽 */}
                <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-3.5 flex flex-col hover:shadow transition-shadow">
                  <div className="flex justify-between items-center border-b border-slate-100 pb-2 mb-0">
                    <span className="font-black text-sm text-slate-800 flex items-center gap-1"><span className="text-lg">⚡</span> 4輪挑戰賽</span>
                    <span className="text-[10px] bg-blue-50 border border-blue-200 text-blue-800 font-extrabold px-1.5 py-0.5 rounded-full">9~16人</span>
                  </div>
                  {renderModeToggle(r4Mode, setR4Mode, 'blue')}
                  <FeeController value={fee4r} onChange={setFee4r} theme="blue" />
                  <div className="space-y-2.5 text-xs sm:text-sm flex-1 mt-1">
                    {(() => {
                      const data = customSpecData.r4;
                      return data.isPrizeMode ? (
                        <>
                          <div className="flex justify-between items-center bg-amber-50/50 p-2 rounded border border-amber-100">
                             <span className="font-bold text-slate-700">🥇 冠軍大獎：</span>
                             <div className="flex items-center gap-1">
                               <span className="text-xs font-bold text-slate-500">$</span>
                               <input type="number" value={r4PrizeCost} onChange={(e)=>setR4PrizeCost(Math.max(0, Number(e.target.value)))} className="w-16 text-center text-xs font-bold border border-amber-300 rounded p-0.5 text-amber-700 focus:outline-amber-500" />
                             </div>
                          </div>
                          <div className="mt-2 text-[11px] bg-slate-50 text-slate-700 p-2 rounded font-bold text-center border border-slate-200 shadow-sm">
                             {data.minPlayers > 100 ? (
                               <span className="text-rose-600">此報名費無法回本，請調高！</span>
                             ) : (
                               <>滿 <span className="text-blue-600 text-sm">{data.minPlayers} 人</span> 開賽 ➔ 毛利 {data.margin.toFixed(1)}%</>
                             )}
                          </div>
                          <div className="flex justify-between items-center bg-blue-50/50 p-2 rounded border border-blue-100 mt-2">
                            <span className="font-bold text-slate-700">🥈 3 勝 1 敗：</span><div className="text-right"><span className="font-bold text-blue-700 text-sm">{data.sub} 包</span></div>
                          </div>
                          <div className="flex justify-between items-center bg-slate-50 p-2 rounded border border-slate-200/60">
                            <span className="font-medium text-slate-500">🛡️ 2~0 勝：</span><span className="font-bold text-slate-600">{data.bot} 包</span>
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="flex justify-between items-center bg-amber-50/50 p-2 rounded border border-amber-100">
                            <span className="font-bold text-slate-700">🥇 4 勝 0 敗：</span>
                            <div className="text-right">
                              <span className="font-black text-amber-700 text-sm">{data.top} 包</span>
                              {getPTCGGuide(data.top + " 包") && <span className="text-[10px] text-slate-950 font-black block leading-none mt-0.5">{getPTCGGuide(data.top + " 包").replace(/[()]/g, '')}</span>}
                              <div className="text-[9px] text-slate-400 font-bold mt-1">(成本: ${data.topCost?.toFixed(0)} / 售價: ${data.topValue?.toFixed(0)})</div>
                            </div>
                          </div>
                          <div className="flex justify-between items-center bg-blue-50/50 p-2 rounded border border-blue-100">
                            <span className="font-bold text-slate-700">🥈 3 勝 1 敗：</span>
                            <div className="text-right"><span className="font-bold text-blue-700 text-sm">{data.sub} 包</span>{getPTCGGuide(data.sub + " 包") && <span className="text-[10px] text-slate-950 font-black block leading-none mt-0.5">{getPTCGGuide(data.sub + " 包").replace(/[()]/g, '')}</span>}</div>
                          </div>
                          <div className="flex justify-between items-center bg-slate-50 p-2 rounded border border-slate-200/60">
                            <span className="font-medium text-slate-500">🛡️ 2~0 勝：</span><span className="font-bold text-slate-600">{data.bot} 包</span>
                          </div>
                        </>
                      )
                    })()}
                  </div>
                </div>

                {/* 5. 五輪終極賽 */}
                <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-3.5 flex flex-col hover:shadow transition-shadow">
                  <div className="flex justify-between items-center border-b border-slate-100 pb-2 mb-0">
                    <span className="font-black text-sm text-slate-800 flex items-center gap-1"><span className="text-lg">🔥</span> 5輪終極賽</span>
                    <span className="text-[10px] bg-indigo-50 border border-indigo-200 text-indigo-800 font-extrabold px-1.5 py-0.5 rounded-full">17~32人</span>
                  </div>
                  {renderModeToggle(r5Mode, setR5Mode, 'indigo')}
                  <FeeController value={fee5r} onChange={setFee5r} theme="indigo" />
                  <div className="space-y-2.5 text-xs sm:text-sm flex-1 mt-1">
                    {(() => {
                      const data = customSpecData.r5;
                      return data.isPrizeMode ? (
                        <>
                          <div className="flex justify-between items-center bg-amber-50/50 p-2 rounded border border-amber-100">
                             <span className="font-bold text-slate-700">🥇 冠軍大獎：</span>
                             <div className="flex items-center gap-1">
                               <span className="text-xs font-bold text-slate-500">$</span>
                               <input type="number" value={r5PrizeCost} onChange={(e)=>setR5PrizeCost(Math.max(0, Number(e.target.value)))} className="w-16 text-center text-xs font-bold border border-amber-300 rounded p-0.5 text-amber-700 focus:outline-amber-500" />
                             </div>
                          </div>
                          <div className="mt-2 text-[11px] bg-slate-50 text-slate-700 p-2 rounded font-bold text-center border border-slate-200 shadow-sm">
                             {data.minPlayers > 100 ? (
                               <span className="text-rose-600">此報名費無法回本，請調高！</span>
                             ) : (
                               <>滿 <span className="text-indigo-600 text-sm">{data.minPlayers} 人</span> 開賽 ➔ 毛利 {data.margin.toFixed(1)}%</>
                             )}
                          </div>
                          <div className="flex justify-between items-center bg-blue-50/50 p-2 rounded border border-blue-100 mt-2">
                            <span className="font-bold text-slate-700">🥈 4 勝 1 敗：</span><div className="text-right"><span className="font-bold text-blue-700 text-sm">{data.sub} 包</span></div>
                          </div>
                          <div className="flex justify-between items-center bg-slate-50 p-2 rounded border border-slate-200/60">
                            <span className="font-medium text-slate-500">🛡️ 3~0 勝：</span><span className="font-bold text-slate-600">{data.bot} 包</span>
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="flex justify-between items-center bg-amber-50/50 p-2 rounded border border-amber-100">
                            <span className="font-bold text-slate-700">🥇 5 勝 0 敗：</span>
                            <div className="text-right">
                              <span className="font-black text-amber-700 text-sm">{data.top} 包</span>
                              {getPTCGGuide(data.top + " 包") && <span className="text-[10px] text-slate-950 font-black block leading-none mt-0.5">{getPTCGGuide(data.top + " 包").replace(/[()]/g, '')}</span>}
                              <div className="text-[9px] text-slate-400 font-bold mt-1">(成本: ${data.topCost?.toFixed(0)} / 售價: ${data.topValue?.toFixed(0)})</div>
                            </div>
                          </div>
                          <div className="flex justify-between items-center bg-blue-50/50 p-2 rounded border border-blue-100">
                            <span className="font-bold text-slate-700">🥈 4 勝 1 敗：</span>
                            <div className="text-right"><span className="font-bold text-blue-700 text-sm">{data.sub} 包</span>{getPTCGGuide(data.sub + " 包") && <span className="text-[10px] text-slate-950 font-black block leading-none mt-0.5">{getPTCGGuide(data.sub + " 包").replace(/[()]/g, '')}</span>}</div>
                          </div>
                          <div className="flex justify-between items-center bg-slate-50 p-2 rounded border border-slate-200/60">
                            <span className="font-medium text-slate-500">🥉 3 勝 2 敗：</span><span className="font-bold text-slate-600">{calculations.actualMidPacks} 包</span>
                          </div>
                          <div className="flex justify-between items-center bg-slate-50 p-2 rounded border border-slate-200/60">
                            <span className="font-medium text-slate-500">🛡️ 2~0 勝：</span><span className="font-bold text-slate-600">{data.bot} 包</span>
                          </div>
                        </>
                      )
                    })()}
                  </div>
                </div>

              </div>
            </div>
          ) : calculations.isGym ? (
            <div className={`flex flex-col bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden min-h-0 transition-all duration-300 ${expandedSections.posterMilestones ? 'flex-[4]' : 'shrink-0'}`}>
              <div onClick={() => toggleSection('posterMilestones')} className="shrink-0 px-3 py-2 bg-indigo-900 text-white text-xs sm:text-sm font-bold flex justify-between items-center cursor-pointer select-none">
                <span className="flex items-center gap-1.5"><span>🖼️</span> 寶可夢官方道館賽海報里程碑 (固定3輪 雙向聯動高亮)</span>
                <div className="flex items-center gap-2"><span className="bg-indigo-700/80 px-2 py-0.5 rounded text-[10px] sm:text-xs">👥 當前報名: {currentPlayers} 人</span><ChevronIcon expanded={expandedSections.posterMilestones} className="text-white" /></div>
              </div>
              {expandedSections.posterMilestones && (
                <div className="p-3 overflow-auto flex-1 bg-slate-50/20 flex flex-col gap-3">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 flex-1">
                    <div className={`rounded-xl border p-4 flex flex-col justify-between transition-all duration-300 shadow-sm relative overflow-hidden h-fit ${calculations.gymActiveStats.activeCard === 'C' ? 'bg-rose-50/80 border-rose-400 ring-4 ring-rose-500/20 transform scale-[1.02]' : 'bg-white border-slate-200 opacity-60'}`}>
                      <div>
                        <div onClick={() => toggleGymCard('league')} className="flex justify-between items-center cursor-pointer select-none border-b pb-2 mb-3">
                          <h3 className="text-sm sm:text-base font-black text-slate-800 flex items-center gap-1.5"><span className="text-xl">🟨</span><span>突發小聯賽 (2 ~ 3人)</span></h3>
                          <div className="flex items-center gap-2"><button onClick={(e) => { e.stopPropagation(); setIsEmergencyEditable(!isEmergencyEditable); if (isEmergencyEditable) { setOverrideWinner2(''); setOverrideLoser2(''); setOverrideP1_A(''); setOverrideP2_A(''); setOverrideP3_A(''); setOverrideP1_B(''); setOverrideP2_B(''); setOverrideP3_B(''); } }} className="bg-rose-700/80 hover:bg-rose-800 text-white font-extrabold px-1.5 py-0.5 rounded text-[9px] flex items-center gap-0.5 active:scale-95 transition-colors">{isEmergencyEditable ? '🔒 鎖定' : '🔓 自訂'}</button><ChevronIcon expanded={gymCardExpanded.league} /></div>
                        </div>
                        {!gymCardExpanded.league && <div className="text-xs text-slate-950 font-black bg-rose-100/30 p-2 rounded border border-rose-200/50 mt-1 animate-in fade-in">🏆 冠軍 7 包 / 亞軍 1 包 <br />🥇 第一名 9 包 / 🥈 第二名 3 包 / 🥉 1 包保底</div>}
                        {gymCardExpanded.league && (
                          <div className="space-y-2.5 text-xs sm:text-sm animate-in fade-in duration-200">
                            <div className="border border-slate-200 rounded-lg overflow-hidden">
                              <div onClick={() => setGymLeague2Expanded(!gymLeague2Expanded)} className="bg-slate-100/80 p-2 text-[11px] font-bold text-rose-900 flex justify-between items-center cursor-pointer select-none"><span>⚔️ 【若當天來 2 人對決】(營收: $600)</span><ChevronIcon expanded={gymLeague2Expanded} className="text-rose-900/60" /></div>
                              {gymLeague2Expanded && (
                                <div className="p-2.5 bg-white space-y-2 border-t border-slate-100 animate-in fade-in duration-150">
                                  <div className="flex justify-between items-center bg-slate-50 px-2 py-1 rounded"><span className="font-semibold text-slate-700">🥇 冠軍 (1勝0敗)：</span><div className="text-right"><span className="font-black text-slate-800">7 包</span><span className="text-[10px] text-slate-950 font-black block leading-none mt-0.5">(換2高級+1一般)</span></div></div>
                                  <div className="flex justify-between items-center bg-slate-50 px-2 py-1 rounded"><span className="font-semibold text-slate-500">🥈 亞軍 (0勝1敗)：</span><span className="font-bold text-slate-600">1 包 (保底)</span></div>
                                </div>
                              )}
                            </div>
                            <div className="border border-slate-200 rounded-lg overflow-hidden">
                              <div onClick={() => setGymLeague3Expanded(!gymLeague3Expanded)} className="bg-slate-100/80 p-2 text-[11px] font-bold text-teal-900 flex justify-between items-center cursor-pointer select-none"><span>🔄 【若當天來 3 人循環】(營收: $900)</span><ChevronIcon expanded={gymLeague3Expanded} className="text-teal-900/60" /></div>
                              {gymLeague3Expanded && (
                                <div className="p-2.5 bg-white space-y-2 border-t border-slate-100 animate-in fade-in duration-150">
                                  <div className="flex justify-between items-center bg-slate-50 px-2 py-1 rounded"><span className="font-semibold text-slate-700">🥇 第一名 (3勝0敗)：</span><div className="text-right"><span className="font-black text-slate-800">9 包</span><span className="text-[10px] text-slate-950 font-black block leading-none mt-0.5">(直換 3 包高級)</span></div></div>
                                  <div className="flex justify-between items-center bg-slate-50 px-2 py-1 rounded"><span className="font-semibold text-slate-700">🥈 第二名 (2勝1敗)：</span><div className="text-right"><span className="font-bold text-slate-700">3 包</span><span className="text-[10px] text-slate-950 font-black block leading-none mt-0.5">(直換 1 包高級)</span></div></div>
                                  <div className="flex justify-between items-center bg-slate-50 px-2 py-1 rounded"><span className="font-semibold text-slate-500">🥉 第三名 (1勝2敗)：</span><span className="font-bold text-slate-600">1 包 (保底)</span></div>
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                      <div className="mt-4 pt-2 border-t border-dashed border-slate-200 text-[11px] text-slate-500 font-semibold flex justify-between"><span>實時利潤判定: </span><span className="text-rose-600 font-black">{currentPlayers === 2 ? '42.4%' : '37.6%'}</span></div>
                    </div>
                    <div className={`rounded-xl border p-4 flex flex-col justify-between transition-all duration-300 shadow-sm relative overflow-hidden h-fit ${calculations.gymActiveStats.activeCard === 'A' ? 'bg-emerald-50/80 border-emerald-400 ring-4 ring-emerald-500/20 transform scale-[1.02]' : 'bg-white border-slate-200 opacity-60'}`}>
                      <div>
                        <div onClick={() => toggleGymCard('normal')} className="flex justify-between items-center cursor-pointer select-none border-b pb-2 mb-3">
                          <h3 className="text-sm sm:text-base font-black text-slate-800 flex items-center gap-1.5"><span className="text-xl">🟩</span><span>常態周賽模式 (4 ~ 16人)</span></h3><ChevronIcon expanded={gymCardExpanded.normal} />
                        </div>
                        {!gymCardExpanded.normal && <div className="text-xs text-slate-950 font-black bg-emerald-100/30 p-2 rounded border border-emerald-200/50 mt-1 animate-in fade-in">🥇 3勝0敗：12 包 (直換 4高級包) <br />🥈 2勝1敗：6 包 (直換 2高級包) | 🛡️ 1 包保底</div>}
                        {gymCardExpanded.normal && (
                          <div className="space-y-3 text-xs sm:text-sm animate-in fade-in duration-200">
                            <div className="flex justify-between items-center bg-amber-50 p-2 rounded border border-amber-100/50"><span className="font-bold text-amber-900">🥇 3 勝 0 敗：</span><div className="text-right"><span className="font-black text-amber-800 text-sm sm:text-base">12 包</span><span className="text-xs font-black text-slate-950 block">可直換 4 包高級包</span></div></div>
                            <div className="flex justify-between items-center bg-blue-50 p-2 rounded border border-blue-100/50"><span className="font-bold text-blue-900">🥈 2 勝 1 敗：</span><div className="text-right"><span className="font-black text-blue-800 text-sm sm:text-base">6 包</span><span className="text-xs font-black text-slate-950 block">可直換 2 包高級包</span></div></div>
                            <div className="flex justify-between items-center bg-slate-50 p-2 rounded border border-slate-200"><span className="font-medium text-slate-600">🛡️ 0 ~ 1 勝：</span><span className="font-bold text-slate-600">1 包 (保底)</span></div>
                          </div>
                        )}
                      </div>
                      <div className="mt-4 pt-2 border-t border-dashed border-slate-200 text-[11px] text-slate-500 font-semibold flex justify-between"><span>預估包成本/人: 4.25包</span><span className="text-emerald-600">實際毛利: 38.8%</span></div>
                    </div>
                    <div className={`rounded-xl border p-4 flex flex-col justify-between transition-all duration-300 shadow-sm relative overflow-hidden h-fit ${calculations.gymActiveStats.activeCard === 'B' ? 'bg-indigo-50/80 border-indigo-400 ring-4 ring-indigo-500/20 transform scale-[1.02]' : 'bg-white border-slate-200 opacity-60'}`}>
                      <div>
                        <div onClick={() => toggleGymCard('grand')} className="flex justify-between items-center cursor-pointer select-none border-b pb-2 mb-3">
                          <h3 className="text-sm sm:text-base font-black text-slate-800 flex items-center gap-1.5"><span className="text-xl">🔵</span><span>大賽造神模式 (17 ~ 32人)</span></h3><ChevronIcon expanded={gymCardExpanded.grand} />
                        </div>
                        {!gymCardExpanded.grand && <div className="text-xs text-slate-950 font-black bg-indigo-100/30 p-2 rounded border border-indigo-200/50 mt-1 animate-in fade-in">🥇 3勝0敗：🔥 15 包 (直換 5高級包) <br />🥈 2勝1敗：6 包 (直換 2高級包) | 🛡️ 1 包保底</div>}
                        {gymCardExpanded.grand && (
                          <div className="space-y-3 text-xs sm:text-sm animate-in fade-in duration-200">
                            <div className="flex justify-between items-center bg-amber-50 p-2 rounded border border-amber-100/50"><span className="font-bold text-amber-900">🥇 3 勝 0 敗：</span><div className="text-right"><span className="font-black text-amber-800 text-sm sm:text-base">🔥 15 包</span><span className="text-xs font-black text-slate-950 block">可直換 5 包高級包</span></div></div>
                            <div className="flex justify-between items-center bg-blue-50 p-2 rounded border border-blue-100/50"><span className="font-bold text-blue-900">🥈 2 勝 1 敗：</span><div className="text-right"><span className="font-black text-blue-800 text-sm sm:text-base">6 包</span><span className="text-xs font-black text-slate-950 block">可直換 2 包高級包</span></div></div>
                            <div className="flex justify-between items-center bg-slate-50 p-2 rounded border border-slate-200"><span className="font-medium text-slate-600">🛡️ 0 ~ 1 勝：</span><span className="font-bold text-slate-600">1 包 (保底)</span></div>
                          </div>
                        )}
                      </div>
                      <div className="mt-4 pt-2 border-t border-dashed border-slate-200 text-[11px] text-slate-500 font-semibold flex justify-between"><span>預估包成本/人: 4.625包</span><span className="text-indigo-600">實際毛利: 33.4%</span></div>
                    </div>
                  </div>
                  <div className="p-2.5 bg-indigo-950 text-white rounded-lg flex flex-col sm:flex-row justify-between items-start sm:items-center text-xs font-bold shadow-md animate-in fade-in">
                    <div className="flex items-center gap-1.5"><span className="text-base">📈</span><span>官方道館賽實時精算看板：</span></div>
                    <div className="flex flex-wrap gap-x-6 gap-y-1 mt-1.5 sm:mt-0"><span>當天總營收: <b className="text-amber-300 text-sm">${calculations.gymActiveStats.rev}</b></span><span>預估死成本: <b className="text-rose-300">-${calculations.gymActiveStats.cost.toFixed(0)}</b></span><span>實時毛利率: <b className="text-emerald-300 text-sm">{calculations.gymActiveStats.margin.toFixed(1)}%</b></span><span>超額可用加碼金: <b className="text-emerald-300">${Math.floor(calculations.gymActiveStats.surplus)}</b></span></div>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className={`flex flex-col bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden min-h-0 transition-all duration-300 ${expandedSections.counterTable ? 'flex-[3]' : 'shrink-0'}`}>
              <div onClick={() => toggleSection('counterTable')} className={`shrink-0 px-3 py-2 border-b text-white text-xs sm:text-sm font-bold flex justify-between items-center cursor-pointer select-none ${calculations.isSmooth ? 'bg-teal-600' : calculations.isGodMode ? 'bg-rose-700' : 'bg-pink-600'}`}>
                <span>一、櫃台發放對照表 {matchRounds === 'auto' ? '(4欄防呆對照)' : `(固定 ${matchRounds} 輪精簡對照)`}</span><ChevronIcon expanded={expandedSections.counterTable} className="text-white" />
              </div>
              {expandedSections.counterTable && (
                <div className="overflow-auto flex-1 min-h-0 p-2 bg-slate-50/30">
                  {matchRounds === 'auto' ? (
                    <table className="w-full text-xs text-center border-collapse">
                      <thead className="bg-slate-50 text-slate-500 border-b border-slate-200 sticky top-0 z-10 shadow-sm">
                        <tr><th className="py-1.5 px-1 border-r border-slate-200 font-bold w-12 bg-slate-50 text-xs sm:text-sm">戰績</th><th className="py-1.5 px-1 border-r border-slate-200 font-bold bg-slate-50 text-xs sm:text-sm">3 輪 <span className="text-[0.68rem] block text-slate-400 font-medium">4~8人</span></th><th className="py-1.5 px-1 border-r border-slate-200 font-bold bg-slate-50 text-xs sm:text-sm">4 輪 <span className="text-[0.68rem] block text-slate-400 font-medium">9~16人</span></th><th className="py-1.5 px-1 border-r border-slate-200 font-extrabold text-teal-700 bg-teal-50 text-xs sm:text-sm">5輪常態 <span className="text-[0.68rem] block text-teal-500 font-semibold">17~24人</span></th><th className="py-1.5 px-1 font-extrabold text-indigo-700 bg-indigo-50 text-xs sm:text-sm">5輪特企 <span className="text-[0.68rem] block text-indigo-400 font-semibold">25~32人</span></th></tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 text-xs sm:text-sm bg-white">
                        <tr className="hover:bg-slate-50 transition-colors"><td className="py-1 px-1 font-bold border-r border-slate-200 bg-slate-50/80 text-slate-700">5 勝</td><td className="py-1 px-1 border-r border-slate-200">{renderTableCell('5勝', '3')}</td><td className="py-1 px-1 border-r border-slate-200">{renderTableCell('5勝', '4')}</td><td className="py-1 px-1 border-r border-slate-200 bg-amber-50/20">{renderTableCell('5勝', '5_normal')}</td><td className="py-1 px-1 bg-amber-100/20">{renderTableCell('5勝', '5_special')}</td></tr>
                        <tr className="hover:bg-slate-50 transition-colors"><td className="py-1 px-1 font-bold border-r border-slate-200 bg-slate-50/80 text-slate-700">4 勝</td><td className="py-1 px-1 border-r border-slate-200">{renderTableCell('4勝', '3')}</td><td className="py-1 px-1 border-r border-slate-200 bg-amber-50/10">{renderTableCell('4勝', '4')}</td><td className="py-1 px-1 border-r border-slate-200">{renderTableCell('4勝', '5_normal')}</td><td className="py-1 px-1">{renderTableCell('4勝', '5_special')}</td></tr>
                        <tr className="hover:bg-slate-50 transition-colors"><td className="py-1.5 px-1 font-bold border-r border-slate-200 bg-slate-50/80 text-slate-700">3 勝</td><td className="py-1.5 px-1 border-r border-slate-200 bg-amber-50/10">{renderTableCell('3勝', '3')}</td><td className="py-1.5 px-1 border-r border-slate-200">{renderTableCell('3勝', '4')}</td><td className="py-1.5 px-1 border-r border-slate-200 bg-slate-50/30">{renderTableCell('3勝', '5_normal')}</td><td className="py-1.5 px-1 bg-slate-50/30">{renderTableCell('3勝', '5_special')}</td></tr>
                        <tr className="hover:bg-slate-50 transition-colors"><td className="py-1.5 px-1 font-bold border-r border-slate-200 bg-slate-50/80 text-slate-700">2 勝</td><td className="py-1.5 px-1 border-r border-slate-200">{renderTableCell('2勝', '3')}</td><td className="py-1.5 px-1 border-r border-slate-200 bg-slate-50/30">{renderTableCell('2勝', '4')}</td><td className="py-1.5 px-1 border-r border-slate-200 bg-slate-50/30">{renderTableCell('2勝', '5_normal')}</td><td className="py-1.5 px-1 bg-slate-50/30">{renderTableCell('2勝', '5_special')}</td></tr>
                        <tr className="hover:bg-slate-50 transition-colors"><td className="py-1.5 px-1 font-bold border-r border-slate-200 bg-slate-50/80 text-slate-700">1~0勝</td><td className="py-1.5 px-1 border-r border-slate-200">{renderTableCell('1~0勝', '3')}</td><td className="py-1.5 px-1 border-r border-slate-200 bg-slate-50/30">{renderTableCell('1~0勝', '4')}</td><td className="py-1.5 px-1 border-r border-slate-200 bg-slate-50/30">{renderTableCell('1~0勝', '5_normal')}</td><td className="py-1.5 px-1 bg-slate-50/30">{renderTableCell('1~0勝', '5_special')}</td></tr>
                      </tbody>
                    </table>
                  ) : (
                    <div className="max-w-md mx-auto bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden my-1">
                      <div className={`px-4 py-2 text-white font-bold text-center text-xs tracking-wider ${calculations.isSmooth ? 'bg-teal-600' : calculations.isGodMode ? 'bg-rose-700' : 'bg-pink-600'}`}>🏆 固定【{matchRounds} 輪】 櫃台兌換標準卡</div>
                      <div className="divide-y divide-slate-100 text-xs sm:text-sm">
                        <div className="flex justify-between items-center px-4 py-3 bg-amber-50/40"><div className="flex items-center gap-2"><span className="text-base">🥇</span><span className="font-extrabold text-slate-800">{matchRounds} 勝 0 敗 (全勝)</span></div><div className="flex flex-col items-end"><span className="text-sm font-black text-amber-700 bg-amber-50 border border-amber-200 px-3 py-1 rounded">{singleRewards.top}</span>{getPTCGGuide(singleRewards.top) && <span className="text-xs text-slate-950 font-black mt-1">{getPTCGGuide(singleRewards.top).replace(/[()]/g, '')}</span>}{singleRewards.topLottery && <span className="text-xs text-slate-950 font-black mt-1">{singleRewards.topLottery}</span>}</div></div>
                        <div className="flex justify-between items-center px-4 py-2.5 bg-blue-50/10"><div className="flex items-center gap-2"><span className="text-base">🥈</span><span className="font-bold text-slate-700">{Number(matchRounds) - 1} 勝 1 敗 (1敗)</span></div><div className="flex flex-col items-end"><span className="text-sm font-extrabold text-blue-700 bg-blue-50 border border-blue-200 px-3 py-1 rounded">{singleRewards.sub}</span>{getPTCGGuide(singleRewards.sub) && <span className="text-xs text-slate-950 font-black mt-1">{getPTCGGuide(singleRewards.sub).replace(/[()]/g, '')}</span>}</div></div>
                        {Number(matchRounds) === 5 && <div className="flex justify-between items-center px-4 py-2.5 bg-teal-50/10"><div className="flex items-center gap-2"><span className="text-base">🥉</span><span className="font-medium text-slate-700">3 勝 2 敗</span></div><div className="flex flex-col items-end"><span className="text-xs font-semibold text-teal-700 bg-teal-50 border border-teal-100 px-3 py-1 rounded">{singleRewards.mid}</span>{getPTCGGuide(singleRewards.mid) && <span className="text-xs text-slate-950 font-black mt-1">{getPTCGGuide(singleRewards.mid).replace(/[()]/g, '')}</span>}</div></div>}
                        {Number(matchRounds) === 4 && <div className="flex justify-between items-center px-4 py-2.5 bg-pink-50/10"><div className="flex items-center gap-2"><span className="text-base">🥉</span><span className="font-medium text-slate-700">2 勝 2 敗</span></div><div className="flex flex-col items-end"><span className="text-xs font-semibold text-pink-700 bg-pink-50 border border-pink-100 px-3 py-1 rounded">{singleRewards.lowMid}</span>{getPTCGGuide(singleRewards.lowMid) && <span className="text-xs text-slate-950 font-black mt-1">{getPTCGGuide(singleRewards.lowMid).replace(/[()]/g, '')}</span>}</div></div>}
                        <div className="flex justify-between items-center px-4 py-2.5 bg-slate-50/50"><div className="flex items-center gap-2"><span className="text-xs">🛡️</span><span className="text-slate-500 font-medium">其餘勝場 (保底)</span></div><span className="text-xs text-slate-500 font-bold bg-slate-100 border border-slate-200 px-3 py-1 rounded">{singleRewards.bot} / {bottomPacks} 包</span></div>
                      </div>
                    </div>
                  )}
                  <div className="mt-2.5 p-2 bg-emerald-50 rounded border border-emerald-200/60 flex justify-between items-center text-xs font-bold text-emerald-800"><div className="flex items-center gap-1.5"><span>💡</span><span>目前人數規模可用彈性加碼金 (多出預算)：</span></div><div className="flex gap-4"><span>8人局: <b className="text-emerald-700">${Math.max(0, Math.floor(calculations.surplus8 || 0))}</b></span><span>16人局: <b className="text-emerald-700">${Math.max(0, Math.floor(calculations.surplus16 || 0))}</b></span><span>24人局: <b className="text-emerald-700 text-sm">${Math.max(0, Math.floor(calculations.surplus24 || 0))}</b></span><span>32人局: <b className="text-emerald-700">${Math.max(0, Math.floor(calculations.surplus32 || 0))}</b></span></div></div>
                </div>
              )}
            </div>
          )}

          {/* v9.8.5: 🚨 2~3人突發面板 (新增解鎖編輯與實時連動) */}
          {!calculations.isGym && rewardModel !== 'custom-spec' && (
            <div className={`flex flex-col bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden min-h-0 transition-all duration-300
                ${expandedSections.emergencyPanel ? 'flex-[2]' : 'shrink-0'}`}>
              <div
                className="shrink-0 px-3 py-2 border-b bg-rose-700 text-white text-xs sm:text-sm font-bold flex justify-between items-center cursor-pointer select-none"
                onClick={() => toggleSection('emergencyPanel')}
              >
                <span className="flex items-center gap-1.5">
                  <span>🚨</span> 2~3人突發局智慧發放面板 (自辦賽自訂連動)
                </span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setIsEmergencyEditable(!isEmergencyEditable);
                      if (isEmergencyEditable) {
                        setOverrideWinner2(''); setOverrideLoser2('');
                        setOverrideP1_A(''); setOverrideP2_A(''); setOverrideP3_A('');
                        setOverrideP1_B(''); setOverrideP2_B(''); setOverrideP3_B('');
                      }
                    }}
                    className="bg-white/10 hover:bg-white/20 border border-white/25 text-white font-extrabold px-2 py-0.5 rounded text-[10px] sm:text-xs flex items-center gap-1 active:scale-95 transition-all mr-2"
                  >
                    {isEmergencyEditable ? '🔒 鎖定防呆' : '🔓 自訂包數'}
                  </button>
                  <ChevronIcon expanded={expandedSections.emergencyPanel} className="text-white" />
                </div>
              </div>

              {expandedSections.emergencyPanel && (
                <div className="p-3 overflow-auto flex-1 bg-slate-50/40 grid grid-cols-1 md:grid-cols-2 gap-3">
                  {/* 2人一擊討 */}
                  <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden flex flex-col justify-between">
                    <div className="bg-rose-50 px-3 py-1.5 border-b border-rose-100 flex justify-between items-center text-xs font-extrabold text-rose-900">
                      <span>⚔️ 2人單挑決鬥賽</span>
                      <span className="text-rose-600 bg-white border border-rose-200 px-1.5 py-0.2 rounded">營收: ${emergency.rev2}</span>
                    </div>
                    <div className="p-3 flex-1 flex flex-col justify-center gap-2">
                      <div className="flex justify-between items-center bg-amber-50/50 p-2 rounded border border-amber-100">
                        <span className="text-xs font-bold text-slate-700">🥇 贏家 (1勝0敗)：</span>
                        <div className="flex flex-col items-end">
                          {isEmergencyEditable ? (
                            <input
                              type="number"
                              className="w-16 border border-rose-300 rounded p-0.5 text-center text-xs font-bold bg-white focus:outline-rose-500"
                              value={overrideWinner2}
                              onChange={(e) => setOverrideWinner2(e.target.value)}
                              placeholder={emergency.winnerPacks2}
                            />
                          ) : (
                            <span className="text-sm font-black text-amber-700">{emergency.winnerPacks2} 包</span>
                          )}
                          {getPTCGGuide(emergency.winnerPacks2 + " 包") && (
                            <span className="text-[10px] text-slate-950 font-black mt-0.5">
                              {getPTCGGuide(emergency.winnerPacks2 + " 包").replace(/[()]/g, '')}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex justify-between items-center bg-slate-100/50 p-2 rounded border border-slate-200/50">
                        <span className="text-xs font-bold text-slate-500">🥈 輸家 (0勝1敗)：</span>
                        {isEmergencyEditable ? (
                          <input
                            type="number"
                            className="w-16 border border-rose-300 rounded p-0.5 text-center text-xs font-bold bg-white focus:outline-rose-500"
                            value={overrideLoser2}
                            onChange={(e) => setOverrideLoser2(e.target.value)}
                            placeholder={emergency.loserPacks2}
                          />
                        ) : (
                          <span className="text-sm font-bold text-slate-600">{emergency.loserPacks2} 包</span>
                        )}
                      </div>
                    </div>
                    <div className="bg-slate-50 px-3 py-1.5 border-t border-slate-100 flex justify-between items-center text-[11px] font-bold">
                      <span className="text-slate-500">實際毛利率：</span>
                      <span className={`text-xs font-black ${emergency.margin2 >= targetMargin ? 'text-teal-600' : 'text-rose-600'}`}>
                        {emergency.margin2.toFixed(1)}%
                      </span>
                    </div>
                  </div>

                  {/* 3人循環賽 */}
                  <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden flex flex-col justify-between">
                    <div className="bg-teal-50 px-3 py-1.5 border-b border-teal-100 flex justify-between items-center text-xs font-extrabold text-teal-900">
                      <div className="flex items-center gap-1.5">
                        <span>🔄 3人循環賽</span>
                        <select 
                          value={threePlayerMode} 
                          onChange={(e) => setThreePlayerMode(e.target.value)}
                          className="bg-white border border-teal-200 rounded text-[10px] px-1 py-0.5 focus:outline-none"
                        >
                          <option value="A">含輪空 (軟體判定)</option>
                          <option value="B">不含輪空 (純實戰)</option>
                        </select>
                      </div>
                      <span className="text-teal-600 bg-white border border-teal-200 px-1.5 py-0.2 rounded">營收: ${emergency.rev3}</span>
                    </div>
                    <div className="p-3 flex-1 flex flex-col justify-center gap-2">
                      {threePlayerMode === 'A' ? (
                        <>
                          <div className="flex justify-between items-center bg-amber-50/50 p-1.5 rounded border border-amber-100">
                            <span className="text-xs font-bold text-slate-700">🥇 第一名 (3勝0敗)：</span>
                            <div className="flex flex-col items-end">
                              {isEmergencyEditable ? (
                                <input
                                  type="number"
                                  className="w-16 border border-teal-300 rounded p-0.5 text-center text-xs font-bold bg-white"
                                  value={overrideP1_A}
                                  onChange={(e) => setOverrideP1_A(e.target.value)}
                                  placeholder={emergency.p1_A}
                                />
                              ) : (
                                <span className="text-sm font-black text-amber-700">{emergency.p1_A} 包</span>
                              )}
                              {getPTCGGuide(emergency.p1_A + " 包") && (
                                <span className="text-[10px] text-slate-950 font-black mt-0.5">
                                  {getPTCGGuide(emergency.p1_A + " 包").replace(/[()]/g, '')}
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="flex justify-between items-center bg-blue-50/50 p-1.5 rounded border border-blue-100">
                            <span className="text-xs font-bold text-slate-700">🥈 第二名 (2勝1敗)：</span>
                            <div className="flex flex-col items-end">
                              {isEmergencyEditable ? (
                                <input
                                  type="number"
                                  className="w-16 border border-teal-300 rounded p-0.5 text-center text-xs font-bold bg-white"
                                  value={overrideP2_A}
                                  onChange={(e) => setOverrideP2_A(e.target.value)}
                                  placeholder={emergency.p2_A}
                                />
                              ) : (
                                <span className="text-sm font-bold text-blue-700">{emergency.p2_A} 包</span>
                              )}
                              {getPTCGGuide(emergency.p2_A + " 包") && (
                                <span className="text-[10px] text-slate-950 font-black mt-0.5">
                                  {getPTCGGuide(emergency.p2_A + " 包").replace(/[()]/g, '')}
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="flex justify-between items-center bg-slate-100/50 p-1.5 rounded border border-slate-200/50">
                            <span className="text-xs font-bold text-slate-500">🥉 第三名 (1勝2敗)：</span>
                            {isEmergencyEditable ? (
                              <input
                                  type="number"
                                  className="w-16 border border-teal-300 rounded p-0.5 text-center text-xs font-bold bg-white"
                                  value={overrideP3_A}
                                  onChange={(e) => setOverrideP3_A(e.target.value)}
                                  placeholder={emergency.p3_A}
                                />
                            ) : (
                              <span className="font-bold text-slate-600">{emergency.p3_A} 包</span>
                            )}
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="flex justify-between items-center bg-amber-50/50 p-1.5 rounded border border-amber-100">
                            <span className="text-xs font-bold text-slate-700">🥇 第一名 (2勝0敗)：</span>
                            <div className="flex flex-col items-end">
                              {isEmergencyEditable ? (
                                <input
                                  type="number"
                                  className="w-16 border border-teal-300 rounded p-0.5 text-center text-xs font-bold bg-white"
                                  value={overrideP1_B}
                                  onChange={(e) => setOverrideP1_B(e.target.value)}
                                  placeholder={emergency.p1_B}
                                />
                              ) : (
                                <span className="text-sm font-black text-amber-700">{emergency.p1_B} 包</span>
                              )}
                              {getPTCGGuide(emergency.p1_B + " 包") && (
                                <span className="text-[10px] text-slate-950 font-black mt-0.5">
                                  {getPTCGGuide(emergency.p1_B + " 包").replace(/[()]/g, '')}
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="flex justify-between items-center bg-blue-50/50 p-1.5 rounded border border-blue-100">
                            <span className="text-xs font-bold text-slate-700">🥈 第二名 (1勝1敗)：</span>
                            <div className="flex flex-col items-end">
                              {isEmergencyEditable ? (
                                <input
                                  type="number"
                                  className="w-16 border border-teal-300 rounded p-0.5 text-center text-xs font-bold bg-white"
                                  value={overrideP2_B}
                                  onChange={(e) => setOverrideP2_B(e.target.value)}
                                  placeholder={emergency.p2_B}
                                />
                              ) : (
                                <span className="text-sm font-bold text-blue-700">{emergency.p2_B} 包</span>
                              )}
                              {getPTCGGuide(emergency.p2_B + " 包") && (
                                <span className="text-[10px] text-slate-950 font-black mt-0.5">
                                  {getPTCGGuide(emergency.p2_B + " 包").replace(/[()]/g, '')}
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="flex justify-between items-center bg-slate-100/50 p-1.5 rounded border border-slate-200/50">
                            <span className="text-xs font-bold text-slate-500">🥉 第三名 (0勝2敗)：</span>
                            {isEmergencyEditable ? (
                              <input
                                  type="number"
                                  className="w-16 border border-teal-300 rounded p-0.5 text-center text-xs font-bold bg-white"
                                  value={overrideP3_B}
                                  onChange={(e) => setOverrideP3_B(e.target.value)}
                                  placeholder={emergency.p3_B}
                                />
                            ) : (
                              <span className="font-bold text-slate-600">{emergency.p3_B} 包</span>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                    <div className="bg-slate-50 px-3 py-1.5 border-t border-slate-100 flex justify-between items-center text-[11px] font-bold">
                      <span className="text-slate-500">實際毛利率：</span>
                      <span className={`text-xs font-black ${
                        (threePlayerMode === 'A' ? emergency.margin3_A : emergency.margin3_B) >= targetMargin ? 'text-teal-600' : 'text-rose-600'
                      }`}>
                        {threePlayerMode === 'A' ? emergency.margin3_A.toFixed(1) : emergency.margin3_B.toFixed(1)}%
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* V9.9.8 警報中心解鎖，移除方案五隱藏條件 */}
          <div className={`flex flex-col bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden min-h-0 transition-all duration-300 ${expandedSections.alertCenter ? 'flex-[2]' : 'shrink-0'}`}>
            <div onClick={() => toggleSection('alertCenter')} className="shrink-0 bg-slate-700 px-3 py-1.5 border-b border-slate-800 text-white flex justify-between items-center text-xs cursor-pointer select-none">
              <span>💡 營運情報與警報中心</span>
              <div className="flex items-center gap-2">
                {!calculations.alertData.hasAlert ? <span className="text-[10px] sm:text-xs bg-emerald-500/90 px-2 py-0.5 rounded shadow-sm">✅ 狀態健康</span> : <span className="text-[10px] sm:text-xs bg-rose-500/90 px-2 py-0.5 rounded shadow-sm animate-pulse">⚠️ 需介入</span>}
                <ChevronIcon expanded={expandedSections.alertCenter} className="text-white" />
              </div>
            </div>

            {expandedSections.alertCenter && (
              <div className="flex-1 overflow-auto p-3 bg-slate-50/50 flex flex-col gap-2">
                {calculations.alertData.hasAlert && calculations.alertData.type === 'smooth_low_margin' ? (
                  <div className="text-xs sm:text-sm">
                    <div className="flex items-center gap-1.5 mb-2"><span className="text-base text-rose-600">🚨</span><b className="text-rose-800">【安全獲利示警】部分人數規模毛利率低於目標：</b></div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-2">
                      {calculations.alertData.data.map((b) => {
                        const isBottomPolicy = twoWinPolicy === 'bottom';
                        return (
                          <div key={b.p} className={`bg-white px-3 py-2 rounded-lg shadow-sm border ${b.r.margin < minMargin ? 'border-red-400 ring-1 ring-red-400/30' : 'border-rose-200'} flex flex-col`}>
                            <div className="flex justify-between items-start mb-1">
                              <span className="text-xs sm:text-sm text-rose-700 font-bold">{rewardModel === 'custom-spec' ? b.label : `${b.p}人局 (${b.r.R}輪)`}</span>
                              <span className="text-xs sm:text-sm font-black text-rose-900">{b.r.margin.toFixed(1)}%</span>
                            </div>
                            <div className="mt-1.5 pt-1.5 border-t border-dashed border-rose-200 bg-rose-50/40 rounded-b text-[10px] sm:text-xs text-rose-700 leading-normal">
                              {b.r.margin < minMargin ? (
                                <><b>🚨 財務告急建議：</b><br />① 將自訂報名費上調至 <b>${b.r.suggestedFee}</b> 元以保障 {targetMargin}% 毛利<br />{(!isBottomPolicy && rewardModel !== 'custom-spec') && <>② 將政策改為 <b>「併入保底」</b> 節省成本<br /></>}</>
                              ) : (
                                <><b>💡 營運微調建議：</b><br />① 將自訂報名費微調至 <b>${b.r.suggestedFee}</b> 元以保障 {targetMargin}% 毛利<br />{(!isBottomPolicy && rewardModel !== 'custom-spec') && <>② 將政策改為 <b>「併入保底」</b> 節省成本<br /></>}</>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  <div className="flex-1 flex flex-col items-center justify-center text-slate-400 opacity-90 my-1">
                    <span className="text-3xl mb-1.5">🛡️</span><h3 className="text-xs sm:text-sm font-bold text-slate-500 mb-0.5">營運狀態健康無虞</h3>
                    <p className="text-[10px] sm:text-xs text-center leading-relaxed">當前賽事產品線的獲利防線固若金湯，店長請放心開賽！</p>
                  </div>
                )}
              </div>
            )}
          </div>

        </div>

        {/* 右側容器：全景邊界壓力測試表 */}
        <div className="flex-[2] flex flex-col bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden min-h-[300px] lg:min-h-0">
          <div className={`shrink-0 px-3 py-1.5 border-b text-white flex justify-between items-center text-xs ${rewardModel === 'custom-spec' ? 'bg-indigo-950 border-indigo-900' : 'bg-slate-700 border-slate-800'}`}>
            <span className="font-bold tracking-wide sm:text-sm">二、全景邊界護盤監控</span>
            <span className="text-[10px] sm:text-xs bg-black/30 px-2 py-0.5 rounded font-medium shadow-sm">目標毛利 ≥ {targetMargin}%</span>
          </div>
          <div className="flex-1 overflow-auto">
            <table className="w-full text-xs text-center border-collapse">
              <thead className="bg-slate-50 text-slate-500 sticky top-0 z-10 shadow-sm">
                <tr><th className="py-2 px-2 border-r border-slate-200 font-bold bg-slate-50 text-xs sm:text-sm">人數情境</th><th className="py-2 px-2 border-r border-slate-200 font-bold bg-slate-50 w-16 text-xs sm:text-sm">營收</th><th className="py-2 px-2 border-r border-slate-200 font-bold bg-slate-50 w-16 text-xs sm:text-sm">成本</th><th className="py-2 px-2 font-bold bg-slate-50 w-16 text-xs sm:text-sm">毛利</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs sm:text-sm">
                {rewardModel === 'custom-spec' ? (
                  <><tr className="bg-indigo-50/80 cursor-default"><td colSpan="4" className="py-2 px-3 border-y border-indigo-100 text-left"><span className="font-bold text-indigo-800 text-xs tracking-wider">🏆 雙軌規格賽 獨立損益監控看板</span></td></tr>{calculations.stressTests.map(renderStressTestRow)}</>
                ) : rewardModel === 'official-gym' ? (
                  <><tr className="bg-slate-100/80 hover:bg-slate-200/60 transition-colors cursor-pointer" onClick={() => toggleSection('round3')}><td colSpan="4" className="py-1.5 px-3 border-y border-slate-200"><div className="flex justify-between items-center select-none"><span className="font-bold text-slate-600 text-xs tracking-wider">🔵 官方道館賽 實時里程碑成本核算</span><ChevronIcon expanded={expandedSections.round3} /></div></td></tr>{expandedSections.round3 && calculations.stressTests.map(renderStressTestRow)}</>
                ) : (
                  <><tr className="bg-slate-100/80 hover:bg-slate-200/60 transition-colors cursor-pointer" onClick={() => toggleSection('round3')}><td colSpan="4" className="py-1.5 px-3 border-y border-slate-200"><div className="flex justify-between items-center select-none"><span className="font-bold text-slate-600 text-xs tracking-wider">📍 常規及臨界規模測試分析</span><ChevronIcon expanded={expandedSections.round3} /></div></td></tr>{expandedSections.round3 && calculations.stressTests.map(renderStressTestRow)}</>
                )}
              </tbody>
            </table>
          </div>
          <div className="shrink-0 p-2 bg-orange-50/80 border-t border-orange-200/50 text-[10px] sm:text-xs text-orange-800 font-semibold text-center">
            💡 提示：系統已全面實裝【瑞士制非線性對戰查找表】，奇數輪空（Bye）的利潤稀釋已 100% 精準代入，拒絕線性預估泡沫！
          </div>
        </div>

      </div>
    </div>
  );
}
