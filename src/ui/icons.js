/* ══════════════════════════════════════════════════════════════
   ICONS — 12×12 도트 아이콘

   이모지는 OS마다 모양이 달라 픽셀 톤이 깨지고, 이미지 파일은 "외부 에셋 0"
   원칙에 걸린다. 그래서 격자 문자열로 직접 찍는다.
   `.` 은 투명, 나머지 글자는 아이콘별 팔레트 키다.
   ══════════════════════════════════════════════════════════════ */
const ICON_N = 12;

const ICONS = {
  /* 도시 모드 — 스카이라인 */
  city: {
    p: { b: '#6B7590', w: '#FFE9A8', g: '#3C4360' },
    d: [
      '............',
      '.....bb.....',
      '....bbbb....',
      '....bwbb....',
      '.bbbbbbbb...',
      '.bwbbwbbb...',
      '.bbbbbbbbbb.',
      '.bwbbwbbwbb.',
      '.bbbbbbbbbb.',
      '.bwbbwbbwbb.',
      '.gggggggggg.',
      '............',
    ],
  },
  /* 사옥 모드 — 차양 달린 가게 */
  store: {
    p: { a: '#F5EFDD', o: '#C4553F', w: '#D8CBA8', g: '#8FB6D6', d: '#8A6A4A', y: '#F2B233', p: '#6B5136' },
    d: [
      '............',
      '............',
      '.aoaoaoaoao.',
      '.oooooooooo.',
      '.wwwwwwwwww.',
      '.wggggw.ddw.',
      '.wggggw.ddw.',
      '.wggggw.dyw.',
      '.wggggw.ddw.',
      '.wwwwwwwwww.',
      '.pppppppppp.',
      '............',
    ],
  },
  /* 회사 — 사옥에 깃발 */
  company: {
    p: { b: '#54607E', w: '#FFE9A8', d: '#20263A', f: '#D0453B', l: '#C6CCE2', g: '#3C4360' },
    d: [
      '............',
      '.....lff....',
      '.....lff....',
      '.....l......',
      '..bbbbbbbb..',
      '..bwwbbwwb..',
      '..bbbbbbbb..',
      '..bwwbbwwb..',
      '..bbbbbbbb..',
      '..bbbddbbb..',
      '..gggggggg..',
      '............',
    ],
  },
  /* 직원 — 넥타이 맨 사원 */
  staff: {
    p: { k: '#2C2418', f: '#F0D9B5', e: '#20263A', s: '#4A86C7', t: '#D0453B' },
    d: [
      '............',
      '....kkkk....',
      '...kkkkkk...',
      '...kffffk...',
      '...kfefek...',
      '...kffffk...',
      '....ffff....',
      '..sssttsss..',
      '.ssssttssss.',
      '.ssssttssss.',
      '.ssssssssss.',
      '............',
    ],
  },
  /* 주식 — 오름세 막대 */
  stock: {
    p: { a: '#4BD69B', b: '#FFD57A', c: '#8FBEEA', g: '#59627E' },
    d: [
      '............',
      '............',
      '........aa..',
      '........aa..',
      '.....bb.aa..',
      '.....bb.aa..',
      '.....bb.aa..',
      '..cc.bb.aa..',
      '..cc.bb.aa..',
      '..cc.bb.aa..',
      '.gggggggggg.',
      '............',
    ],
  },
  /* 은행 — 박공지붕과 기둥 */
  bank: {
    p: { r: '#E8E4D8', c: '#CDBE97', p: '#8A8F9E' },
    d: [
      '............',
      '.....rr.....',
      '....rrrr....',
      '...rrrrrr...',
      '..rrrrrrrr..',
      '.rrrrrrrrrr.',
      '..cc.cc.cc..',
      '..cc.cc.cc..',
      '..cc.cc.cc..',
      '..cc.cc.cc..',
      '.pppppppppp.',
      '............',
    ],
  },
  /* 무당 — 부적 */
  shaman: {
    p: { p: '#F2E2A8', r: '#C4302B' },
    d: [
      '............',
      '...pppppp...',
      '...prrrrp...',
      '...prpprp...',
      '...prrrrp...',
      '...prpppp...',
      '...prrrrp...',
      '...prpprp...',
      '...prrrrp...',
      '...pppppp...',
      '............',
      '............',
    ],
  },
  /* 찌라시 — 쪽지 */
  rumor: {
    p: { o: '#E8E4D8', t: '#5C5340' },
    d: [
      '............',
      '..oooooooo..',
      '..oooooooo..',
      '..otttttoo..',
      '..oooooooo..',
      '..ottttooo..',
      '..oooooooo..',
      '..otttttoo..',
      '..oooooooo..',
      '...oo.......',
      '..o.........',
      '............',
    ],
  },
  /* 알림 — 봉투 */
  inbox: {
    p: { o: '#8A8F9E', f: '#F5EFDD', s: '#CDBE97' },
    d: [
      '............',
      '............',
      '.oooooooooo.',
      '.offffffffo.',
      '.ofsffffsfo.',
      '.offsffsffo.',
      '.offfssfffo.',
      '.offffffffo.',
      '.offffffffo.',
      '.oooooooooo.',
      '............',
      '............',
    ],
  },
};

/* 같은 아이콘은 화면에 한 번만 나오므로 엘리먼트를 통째로 재사용한다.
   독을 매 틱 다시 그려도 캔버스를 새로 굽지 않는다. */
const CACHE = new Map();

/** 아이콘 하나를 캔버스 엘리먼트로 굽는다. 정수 배율이라 확대해도 안 뭉갠다. */
function iconEl(name, scale = 3) {
  const key = name + '@' + scale;
  if (CACHE.has(key)) return CACHE.get(key);
  const el = document.createElement('canvas');
  el.className = 'ico';
  el.width = ICON_N * scale; el.height = ICON_N * scale;
  CACHE.set(key, el);
  const ic = ICONS[name], g = el.getContext('2d');
  if (!ic || !g) return el;
  g.imageSmoothingEnabled = false;
  ic.d.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const c = ic.p[row[x]];
      if (!c) continue;
      g.fillStyle = c;
      g.fillRect(x * scale, y * scale, scale, scale);
    }
  });
  return el;
}

/** `<i data-ico="...">` 자리표시자를 실제 아이콘으로 갈아 끼운다. */
function fillIcons(root, scale = 3) {
  root.querySelectorAll('[data-ico]').forEach(slot => {
    const el = iconEl(slot.dataset.ico, scale);
    slot.replaceWith(el);
  });
}

export { ICONS, ICON_N, fillIcons, iconEl };
