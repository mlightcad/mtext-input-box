import type { Box } from '@mlightcad/text-box-cursor';

export interface DemoCase {
  id: string;
  name: string;
  containerBox: Box;
  chars: string[];
  charBoxes: Box[];
  lineBreakIndices?: number[];
  lineLayouts?: { y: number; height: number }[];
}

export const demoCases: DemoCase[] = [
  {
    id: 'mixed',
    name: 'Mixed Font Sizes',
    containerBox: { x: 40, y: 40, width: 620, height: 220 },
    chars: ['标', '题', '文', '混', '排', '！', '注', '释', '文', '本', '🔔'],
    charBoxes: [
      { x: 60, y: 70, width: 40, height: 48 },
      { x: 106, y: 70, width: 40, height: 48 },
      { x: 164, y: 80, width: 12, height: 24 },
      { x: 180, y: 80, width: 12, height: 24 },
      { x: 196, y: 80, width: 12, height: 24 },
      { x: 224, y: 76, width: 20, height: 32 },
      { x: 80, y: 150, width: 10, height: 18 },
      { x: 96, y: 150, width: 10, height: 18 },
      { x: 112, y: 150, width: 10, height: 18 },
      { x: 128, y: 150, width: 10, height: 18 },
      { x: 146, y: 148, width: 16, height: 24 }
    ]
  },
  {
    id: 'emoji',
    name: 'Punctuation / Emoji',
    containerBox: { x: 40, y: 300, width: 620, height: 170 },
    chars: ['.', ',', ';', '😊', '🎮', '爆'],
    charBoxes: [
      { x: 60, y: 320, width: 4, height: 24 },
      { x: 70, y: 320, width: 4, height: 24 },
      { x: 80, y: 320, width: 8, height: 24 },
      { x: 102, y: 310, width: 32, height: 32 },
      { x: 142, y: 310, width: 32, height: 32 },
      { x: 202, y: 300, width: 50, height: 60 }
    ]
  },
  {
    id: 'irregular',
    name: 'Irregular Layout',
    containerBox: { x: 40, y: 40, width: 620, height: 330 },
    chars: ['光', '标', '动', '画', '模', '拟', '上', '下', '错'],
    charBoxes: [
      { x: 60, y: 90, width: 20, height: 30 },
      { x: 100, y: 92, width: 20, height: 30 },
      { x: 150, y: 88, width: 20, height: 30 },
      { x: 182, y: 95, width: 20, height: 30 },
      { x: 232, y: 85, width: 20, height: 30 },
      { x: 70, y: 160, width: 18, height: 26 },
      { x: 100, y: 162, width: 18, height: 26 },
      { x: 140, y: 158, width: 30, height: 40 },
      { x: 190, y: 155, width: 12, height: 20 }
    ]
  },
  {
    id: 'explicit-breaks',
    name: 'Explicit lineBreakIndices',
    containerBox: { x: 40, y: 40, width: 620, height: 220 },
    chars: ['显', '式', '换', '行', '索', '引', '演', '示', '✅'],
    charBoxes: [
      { x: 60, y: 90, width: 22, height: 30 },
      { x: 86, y: 90, width: 22, height: 30 },
      { x: 112, y: 90, width: 22, height: 30 },
      { x: 60, y: 140, width: 22, height: 30 },
      { x: 86, y: 140, width: 22, height: 30 },
      { x: 112, y: 140, width: 22, height: 30 },
      { x: 60, y: 190, width: 22, height: 30 },
      { x: 86, y: 190, width: 22, height: 30 },
      { x: 112, y: 190, width: 24, height: 30 }
    ],
    lineBreakIndices: [3, 6]
  },
  {
    id: 'empty-paragraph',
    name: 'Explicit Empty Paragraph',
    containerBox: { x: 40, y: 40, width: 620, height: 240 },
    chars: ['前', '段', '后', '段'],
    charBoxes: [
      { x: 60, y: 90, width: 22, height: 30 },
      { x: 86, y: 90, width: 22, height: 30 },
      { x: 60, y: 190, width: 22, height: 30 },
      { x: 86, y: 190, width: 22, height: 30 }
    ],
    // [2, 2, 4] means: first line ends at 2, then one empty line, then continue from 2, then one trailing empty line.
    lineBreakIndices: [2, 2, 4],
    lineLayouts: [
      { y: 90, height: 30 },
      { y: 140, height: 30 },
      { y: 190, height: 30 },
      { y: 240, height: 30 }
    ]
  },
  {
    id: 'empty',
    name: 'Empty Text Box',
    containerBox: { x: 40, y: 40, width: 620, height: 220 },
    chars: [],
    charBoxes: []
  }
];
