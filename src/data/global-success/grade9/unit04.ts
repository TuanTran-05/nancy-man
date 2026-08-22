import { LessonDeck } from '../../../types';

const deck: LessonDeck = {
  id: 'gs-g9-u4-remembering-the-past',
  curriculumFamily: 'global-success',
  grade: 9,
  unitNumber: 4,
  title: 'Grammar Grade 9 - Unit 4: Remembering the Past',
  description:
    'Past continuous and Wish + Past Simple for talking about past activities, memories, heritage, traditions, and present wishes.',
  createdAt: '2026-05-18T00:00:00.000Z',
  slides: [
    {
      id: 'u4-s01-outline',
      title: 'Unit 4: Remembering the Past',
      subtitle: 'Nhớ về quá khứ',
      layout: 'outline',
      bullets: [
        { content: 'Past Continuous' },
        { content: 'When and while' },
        { content: 'Past Continuous vs Past Simple' },
        { content: 'Wish + Past Simple' },
        { content: 'Vocabulary and communication about the past' },
      ],
    },
    {
      id: 'u4-s02-objectives',
      title: 'Lesson Objectives',
      layout: 'objectives',
      bullets: [
        { content: 'Use Past Continuous to describe actions happening at a point in the past.' },
        { content: 'Combine Past Continuous with Past Simple using when.' },
        { content: 'Use while to describe two actions happening at the same time.' },
        { content: 'Use Wish + Past Simple, were, and could to express present wishes or regret.' },
      ],
    },
    {
      id: 'u4-s03-past-continuous-cover',
      title: 'I. Past Continuous',
      subtitle: 'Thì quá khứ tiếp diễn',
      layout: 'section-cover',
    },
    {
      id: 'u4-s04-definition',
      title: 'Past Continuous: Meaning',
      layout: 'explain',
      sections: [
        {
          title: 'Meaning',
          content:
            'Past Continuous describes an action that was happening at a specific time in the past.',
        },
        {
          title: 'Unit 4 context',
          content:
            'It is useful for telling past stories, describing background actions, and talking about activities in old villages, museums, or historical places.',
        },
        {
          title: 'Examples',
          content:
            'At 8 p.m. last night, I was reading a book about ancient villages. My grandmother was telling us stories about the past.',
        },
      ],
    },
    {
      id: 'u4-s05-affirmative',
      title: 'Affirmative Form',
      layout: 'cards',
      cards: [
        {
          title: 'Formula',
          content: 'S + was / were + V-ing.',
          example: 'I was looking at old photos.',
        },
        {
          title: 'I / he / she / it',
          content: 'Use was.',
          example: 'She was watching an old documentary.',
        },
        {
          title: 'You / we / they',
          content: 'Use were.',
          example: 'They were visiting an ancient temple.',
        },
      ],
    },
    {
      id: 'u4-s06-negative',
      title: 'Negative Form',
      layout: 'explain',
      sections: [
        {
          title: 'Formula',
          content: 'S + was / were + not + V-ing.',
        },
        {
          title: 'Short forms',
          content: "Was not = wasn't. Were not = weren't.",
        },
        {
          title: 'Examples',
          content:
            "I wasn't sleeping at 9 p.m. last night. They weren't visiting the museum yesterday morning.",
        },
      ],
    },
    {
      id: 'u4-s07-yes-no',
      title: 'Yes / No Questions',
      layout: 'cards',
      cards: [
        {
          title: 'Formula',
          content: 'Was / Were + S + V-ing?',
          example: 'Were you studying history at 8 p.m.?',
        },
        {
          title: 'With was',
          content: 'Use was with I, he, she, it.',
          example: 'Was she looking at old photos?',
        },
        {
          title: 'With were',
          content: 'Use were with you, we, they.',
          example: 'Were they visiting the citadel?',
        },
      ],
    },
    {
      id: 'u4-s08-short-answers',
      title: 'Short Answers',
      layout: 'cards',
      cards: [
        {
          title: 'Was she reading?',
          content: 'Yes, she was. / No, she was not.',
          example: 'Was she reading an old diary? Yes, she was.',
        },
        {
          title: 'Were they visiting?',
          content: 'Yes, they were. / No, they were not.',
          example: 'Were they visiting the museum? No, they were not.',
        },
        {
          title: 'Were you listening?',
          content: 'Yes, I was. / No, I was not.',
          example: 'Were you listening to the guide? Yes, I was.',
        },
      ],
    },
    {
      id: 'u4-s09-wh-questions',
      title: 'Wh-Questions',
      layout: 'explain',
      sections: [
        {
          title: 'Formula',
          content: 'Wh-word + was / were + S + V-ing?',
        },
        {
          title: 'Examples',
          content:
            'What were you doing at 7 p.m. yesterday? Where were they going when you saw them?',
        },
        {
          title: 'Answer',
          content: 'Answer with a Past Continuous sentence: I was reading about ancient customs.',
        },
      ],
    },
    {
      id: 'u4-s10-specific-time',
      title: 'Use 1: A Specific Time in the Past',
      layout: 'cards',
      cards: [
        {
          title: 'Time markers',
          content:
            'at 7 p.m. yesterday, at this time last night, at that moment, all day yesterday',
          example: 'At this time yesterday, I was visiting an old village.',
        },
        {
          title: 'Background action',
          content: 'The action was in progress at that time.',
          example: 'At that moment, the students were listening to the tour guide.',
        },
        {
          title: 'Long activity',
          content: 'Use all day yesterday for an action continuing for a long period.',
          example: 'All day yesterday, they were preparing for the traditional festival.',
        },
      ],
    },
    {
      id: 'u4-s11-when',
      title: 'Use 2: Interrupted Action with When',
      layout: 'explain',
      sections: [
        {
          title: 'Formula',
          content: 'S + was / were + V-ing + when + S + V2/ed.',
        },
        {
          title: 'Meaning',
          content: 'A longer action was happening when a shorter action interrupted it.',
        },
        {
          title: 'Examples',
          content:
            'I was reading old letters when my mother came home. They were visiting the temple when it started to rain.',
        },
      ],
    },
    {
      id: 'u4-s12-when-front',
      title: 'When at the Beginning',
      layout: 'cards',
      cards: [
        {
          title: 'Formula',
          content: 'When + S + V2/ed, S + was / were + V-ing.',
          example: 'When we arrived, the guide was explaining the history of the citadel.',
        },
        {
          title: 'Past Simple',
          content: 'Use Past Simple for the shorter action.',
          example: 'When I called her, she was looking at old photos.',
        },
        {
          title: 'Past Continuous',
          content: 'Use Past Continuous for the action in progress.',
          example: 'When it started to rain, they were visiting the temple.',
        },
      ],
    },
    {
      id: 'u4-s13-while',
      title: 'Use 3: Parallel Actions with While',
      layout: 'explain',
      sections: [
        {
          title: 'Formula',
          content: 'While + S + was / were + V-ing, S + was / were + V-ing.',
        },
        {
          title: 'Meaning',
          content: 'Use while when two actions were happening at the same time in the past.',
        },
        {
          title: 'Examples',
          content:
            'While my grandmother was cooking, my grandfather was telling old stories. While we were walking around the village, the guide was explaining its history.',
        },
      ],
    },
    {
      id: 'u4-s14-when-while',
      title: 'When and While',
      layout: 'cards',
      cards: [
        {
          title: 'When',
          content: 'Often introduces a short action that interrupts a longer action.',
          example: 'I was studying history when the phone rang.',
        },
        {
          title: 'While',
          content: 'Often introduces an action happening at the same time as another action.',
          example: 'While I was reading, my brother was listening to music.',
        },
        {
          title: 'Memory story',
          content: 'Use both to make a story about the past clearer.',
          example: 'They were visiting the museum when it rained.',
        },
      ],
    },
    {
      id: 'u4-s15-ing-rules',
      title: 'Rules for Adding -ing',
      layout: 'cards',
      cards: [
        {
          title: 'Most verbs',
          content: 'Add -ing.',
          example: 'visit -> visiting',
        },
        {
          title: 'Silent -e',
          content: 'Drop -e and add -ing.',
          example: 'make -> making',
        },
        {
          title: 'One vowel + one consonant',
          content: 'Double the final consonant and add -ing.',
          example: 'sit -> sitting',
        },
        {
          title: '-ie',
          content: 'Change -ie to y and add -ing.',
          example: 'lie -> lying',
        },
      ],
    },
    {
      id: 'u4-s16-past-continuous-vs-simple',
      title: 'Past Continuous vs Past Simple',
      layout: 'cards',
      cards: [
        {
          title: 'Past Continuous',
          content: 'An action was happening at a time in the past.',
          example: 'I was watching a documentary at 9 p.m.',
        },
        {
          title: 'Past Simple',
          content: 'An action happened and finished in the past.',
          example: 'I watched a documentary last night.',
        },
        {
          title: 'Together',
          content:
            'Use Past Continuous for the long action and Past Simple for the interrupting action.',
          example: 'I was watching a documentary when my friend called.',
        },
      ],
    },
    {
      id: 'u4-s17-common-errors-past',
      title: 'Common Mistakes: Past Continuous',
      layout: 'cards',
      cards: [
        {
          title: 'Missing was / were',
          content: 'Do not write V-ing alone.',
          example: 'Correct: I was reading old stories.',
        },
        {
          title: 'Missing V-ing',
          content: 'After was / were, use V-ing.',
          example: 'Correct: She was reading a diary.',
        },
        {
          title: 'Wrong be form',
          content: 'Choose was or were correctly.',
          example: 'Correct: They were listening to the guide.',
        },
      ],
    },
    {
      id: 'u4-s18-detailed-examples-past',
      title: 'Detailed Examples',
      layout: 'explain',
      sections: [
        {
          title: 'Example 1',
          content:
            'At 7 p.m. yesterday, my grandmother was telling us stories about the past. The time phrase shows a specific point in the past.',
        },
        {
          title: 'Example 2',
          content:
            'They were visiting the ancient temple when it started to rain. Were visiting is the longer action; started is the interrupting action.',
        },
        {
          title: 'Example 3',
          content:
            'While we were walking around the old town, the guide was explaining its history. Two actions happened at the same time.',
        },
      ],
    },
    {
      id: 'u4-s19-practice-was-were',
      title: 'Practice 1: Choose Was or Were',
      layout: 'practice',
      sections: [
        {
          title: 'I ___ looking at old photos at 8 p.m.',
          example: 'was',
        },
        {
          title: 'They ___ visiting the ancient temple.',
          example: 'were',
        },
        {
          title: 'She ___ reading an old diary.',
          example: 'was',
        },
        {
          title: 'We ___ learning about traditional customs.',
          example: 'were',
        },
      ],
    },
    {
      id: 'u4-s20-practice-when-while',
      title: 'Practice 2: When or While',
      layout: 'practice',
      sections: [
        {
          title: 'I was reading old letters ___ my mother came home.',
          example: 'when',
        },
        {
          title: '___ my grandmother was cooking, my grandfather was telling stories.',
          example: 'While',
        },
        {
          title: 'They were visiting the museum ___ it started to rain.',
          example: 'when',
        },
        {
          title: '___ we were walking around the village, the guide was explaining its history.',
          example: 'While',
        },
      ],
    },
    {
      id: 'u4-s21-wish-cover',
      title: 'II. Wish + Past Simple',
      subtitle: 'Điều ước trái với hiện tại',
      layout: 'section-cover',
    },
    {
      id: 'u4-s22-wish-meaning',
      title: 'Wish + Past Simple: Meaning',
      layout: 'explain',
      sections: [
        {
          title: 'Meaning',
          content:
            'Wish + Past Simple expresses an unreal wish about the present or regret about a present situation.',
        },
        {
          title: 'Unit 4 context',
          content:
            'Use it to talk about family history, old traditions, heritage sites, ancestors, and things we cannot do now.',
        },
        {
          title: 'Examples',
          content:
            'I wish I knew more about my family history. We wish people preserved old traditions better.',
        },
      ],
    },
    {
      id: 'u4-s23-wish-regular',
      title: 'Wish with Ordinary Verbs',
      layout: 'cards',
      cards: [
        {
          title: 'Formula',
          content: 'S + wish / wishes + S + V2/ed.',
          example: 'I wish I lived near the old town.',
        },
        {
          title: 'Irregular verbs',
          content: 'Use the past form.',
          example: 'We wish we knew more about our ancestors.',
        },
        {
          title: 'Have',
          content: 'Use had for the past simple form.',
          example: 'They wish they had more old photos.',
        },
      ],
    },
    {
      id: 'u4-s24-wish-were',
      title: 'Wish with Be',
      layout: 'explain',
      sections: [
        {
          title: 'Formula',
          content: 'S + wish / wishes + S + were + ...',
        },
        {
          title: 'Important note',
          content: 'In this wish structure, were is commonly used for all subjects.',
        },
        {
          title: 'Examples',
          content:
            'I wish I were at the heritage site now. She wishes she were a historian. We wish the old village were still there.',
        },
      ],
    },
    {
      id: 'u4-s25-wish-could',
      title: 'Wish with Could',
      layout: 'cards',
      cards: [
        {
          title: 'Formula',
          content: 'S + wish / wishes + S + could + V.',
          example: 'I wish I could visit the Imperial Citadel of Thang Long.',
        },
        {
          title: 'Meaning',
          content: 'Use could when you wish you had the ability or chance to do something now.',
          example: 'She wishes she could speak with her great-grandparents.',
        },
        {
          title: 'Past imagination',
          content: 'Could can express impossible wishes about seeing the past.',
          example: 'We wish we could see the village in the past.',
        },
      ],
    },
    {
      id: 'u4-s26-wish-unreal-present',
      title: 'Use 1: Unreal Present Wishes',
      layout: 'explain',
      sections: [
        {
          title: 'Use',
          content: 'Use Wish + Past Simple for something that is not true now.',
        },
        {
          title: 'Examples',
          content:
            'I wish I knew more about local history. She wishes she had an old family photo album.',
        },
        {
          title: 'Reality',
          content: 'The real situation is opposite: I do not know much about local history now.',
        },
      ],
    },
    {
      id: 'u4-s27-wish-regret',
      title: 'Use 2: Present Regret',
      layout: 'cards',
      cards: [
        {
          title: 'Regret',
          content: 'Wish can show sadness about a present situation.',
          example: 'I wish I could meet my ancestors.',
        },
        {
          title: 'Time',
          content: 'Wish can express regret about not having enough time now.',
          example: 'He wishes he had more time to visit historical sites.',
        },
        {
          title: 'Memory',
          content: 'Wish can describe a memory someone wants to have.',
          example: 'My mother wishes she remembered more stories from her childhood.',
        },
      ],
    },
    {
      id: 'u4-s28-wish-preservation',
      title: 'Use 3: Preserving the Past',
      layout: 'explain',
      sections: [
        {
          title: 'Traditions',
          content: 'We wish people preserved historical buildings.',
        },
        {
          title: 'Values',
          content: 'I wish young people understood the value of traditions.',
        },
        {
          title: 'Heritage',
          content: 'She wishes the community protected its heritage better.',
        },
      ],
    },
    {
      id: 'u4-s29-negative-wish',
      title: 'Negative Form with Wish',
      layout: 'cards',
      cards: [
        {
          title: "Didn't + V",
          content: "Use didn't + base verb for ordinary verbs.",
          example: "I wish people didn't forget old customs.",
        },
        {
          title: "Weren't",
          content: "Use weren't for be in the negative.",
          example: "She wishes the museum weren't so far away.",
        },
        {
          title: 'Present regret',
          content: 'The wish is about a present situation.',
          example: "We wish the old buildings weren't damaged.",
        },
      ],
    },
    {
      id: 'u4-s30-wish-vs-hope',
      title: 'Wish and Hope',
      layout: 'cards',
      cards: [
        {
          title: 'Wish + Past Simple',
          content: 'An unreal present wish.',
          example: 'I wish I knew more about history.',
        },
        {
          title: 'Hope + present / future',
          content: 'Something possible in the present or future.',
          example: 'I hope I can visit the museum tomorrow.',
        },
        {
          title: 'Difference',
          content: 'Wish often means the situation is not true now; hope means it may happen.',
          example: 'I wish I could visit now. I hope I can visit next week.',
        },
      ],
    },
    {
      id: 'u4-s31-common-errors-wish',
      title: 'Common Mistakes: Wish',
      layout: 'cards',
      cards: [
        {
          title: 'Do not use present simple',
          content: 'After wish, move the verb back.',
          example: 'Correct: I wish I knew more about the past.',
        },
        {
          title: 'Can becomes could',
          content: 'Use could after wish.',
          example: 'Correct: She wishes she could visit the museum.',
        },
        {
          title: 'Be becomes were',
          content: 'Were is commonly used for all subjects.',
          example: 'Correct: She wishes she were a historian.',
        },
      ],
    },
    {
      id: 'u4-s32-detailed-examples-wish',
      title: 'Detailed Examples',
      layout: 'explain',
      sections: [
        {
          title: 'Example 1',
          content:
            'I wish I knew more about my ancestors. The real meaning is: I do not know much about my ancestors now.',
        },
        {
          title: 'Example 2',
          content:
            'She wishes she could visit the old village. The real meaning is: she cannot visit it now.',
        },
        {
          title: 'Example 3',
          content:
            'We wish the old customs were still popular. The real meaning is: the customs are not very popular now.',
        },
      ],
    },
    {
      id: 'u4-s33-practice-wish-transform',
      title: 'Practice 3: Rewrite with Wish',
      layout: 'practice',
      sections: [
        {
          title: 'I do not know much about my family history.',
          example: 'I wish I knew more about my family history.',
        },
        {
          title: 'She cannot visit the ancient village.',
          example: 'She wishes she could visit the ancient village.',
        },
        {
          title: 'The old houses are not in good condition.',
          example: 'We wish the old houses were in good condition.',
        },
        {
          title: 'People forget old customs.',
          example: 'I wish people did not forget old customs.',
        },
      ],
    },
    {
      id: 'u4-s34-practice-wish-choose',
      title: 'Practice 4: Choose the Correct Form',
      layout: 'practice',
      sections: [
        {
          title: 'I wish I ___ more about the past. A. know B. knew C. knows',
          example: 'B. knew',
        },
        {
          title: 'She wishes she ___ a historian. A. were B. is C. be',
          example: 'A. were',
        },
        {
          title: 'We wish we ___ travel back in time. A. can B. could C. will',
          example: 'B. could',
        },
        {
          title: "They wish people ___ forget old traditions. A. don't B. didn't C. weren't",
          example: "B. didn't",
        },
      ],
    },
    {
      id: 'u4-s35-vocab-cover',
      title: 'III. Vocabulary: Remembering the Past',
      subtitle: 'Từ vựng về lịch sử, di sản và ký ức',
      layout: 'section-cover',
    },
    {
      id: 'u4-s36-vocab-heritage',
      title: 'Heritage and History',
      layout: 'cards',
      cards: [
        {
          title: 'heritage',
          content: 'di sản',
          example: 'Viet Nam has rich cultural heritage.',
        },
        {
          title: 'historical site',
          content: 'di tích lịch sử',
          example: 'We visited a historical site last week.',
        },
        {
          title: 'citadel',
          content: 'thành cổ / kinh thành',
          example: 'The citadel was built many years ago.',
        },
        {
          title: 'museum',
          content: 'bảo tàng',
          example: 'The museum displays old objects.',
        },
      ],
    },
    {
      id: 'u4-s37-vocab-customs',
      title: 'Traditions and Memories',
      layout: 'cards',
      cards: [
        {
          title: 'custom',
          content: 'phong tục',
          example: 'This custom is still popular today.',
        },
        {
          title: 'ancestor',
          content: 'tổ tiên',
          example: 'People worship their ancestors.',
        },
        {
          title: 'pass down',
          content: 'truyền lại',
          example: 'Customs are passed down from generation to generation.',
        },
        {
          title: 'look at old photos',
          content: 'xem ảnh cũ',
          example: 'We looked at old photos together.',
        },
      ],
    },
    {
      id: 'u4-s38-vocab-adjectives',
      title: 'Adjectives for the Past and Heritage',
      layout: 'cards',
      cards: [
        {
          title: 'ancient / historical',
          content: 'cổ xưa / thuộc lịch sử',
          example: 'The ancient temple is famous.',
        },
        {
          title: 'valuable',
          content: 'có giá trị',
          example: 'Old photos are valuable to families.',
        },
        {
          title: 'memorable',
          content: 'đáng nhớ',
          example: 'It was a memorable visit.',
        },
        {
          title: 'recognised',
          content: 'được công nhận',
          example: 'The site was recognised by UNESCO.',
        },
      ],
    },
    {
      id: 'u4-s39-communication',
      title: 'Common Communication Structures',
      layout: 'cards',
      cards: [
        {
          title: 'At + time + in the past',
          content: 'Describe an action in progress at a past time.',
          example: 'At 8 p.m. yesterday, I was reading about Vietnamese history.',
        },
        {
          title: 'Past Continuous + when + Past Simple',
          content: 'Describe an interrupted action.',
          example: 'I was looking at old photos when my mother came in.',
        },
        {
          title: 'Wish + Past Simple',
          content: 'Talk about a present wish.',
          example: 'I wish I knew more about my family history.',
        },
        {
          title: 'Wish + could + V',
          content: 'Talk about an ability or chance you do not have now.',
          example: 'We wish we could travel back to the past.',
        },
      ],
    },
    {
      id: 'u4-s40-summary',
      title: 'Unit 4 Summary',
      layout: 'outline',
      bullets: [
        { content: 'Past Continuous: S + was / were + V-ing.' },
        { content: 'Use Past Continuous for actions happening at a point in the past.' },
        { content: 'Use when for an interrupted action and while for parallel actions.' },
        { content: 'Wish + Past Simple expresses an unreal present wish.' },
        { content: 'Use were with be and could for ability in wish sentences.' },
        { content: 'Do not forget was / were in Past Continuous or the past form after wish.' },
      ],
    },
  ],
};

export default deck;
