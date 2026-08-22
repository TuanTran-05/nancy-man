import { LessonDeck } from '../../../types';

const deck: LessonDeck = {
  id: 'gs-g9-u5-our-experiences',
  curriculumFamily: 'global-success',
  grade: 9,
  unitNumber: 5,
  title: 'Grammar Grade 9 - Unit 5: Our Experiences',
  description:
    'The Present Perfect for talking about experiences, completed actions, recent events, and memorable activities.',
  createdAt: '2026-05-18T00:00:00.000Z',
  slides: [
    {
      id: 'u5-s01-outline',
      title: 'Unit 5: Our Experiences',
      subtitle: 'Những trải nghiệm của chúng ta',
      layout: 'outline',
      bullets: [
        { content: 'The Present Perfect' },
        { content: 'Have / has + V3/ed' },
        { content: 'Ever, never, already, yet, just' },
        { content: 'Present Perfect vs Past Simple' },
        { content: 'Vocabulary and communication about experiences' },
      ],
    },
    {
      id: 'u5-s02-objectives',
      title: 'Lesson Objectives',
      layout: 'objectives',
      bullets: [
        {
          content:
            'Use the Present Perfect to talk about past experiences connected to the present.',
        },
        { content: 'Make affirmative, negative, Yes / No, and Wh-questions with have / has + V3.' },
        { content: 'Use ever, never, already, yet, just, recently, so far, and before correctly.' },
        {
          content:
            'Distinguish Present Perfect from Past Simple when a specific past time is mentioned.',
        },
      ],
    },
    {
      id: 'u5-s03-cover',
      title: 'I. The Present Perfect',
      subtitle: 'Thì hiện tại hoàn thành',
      layout: 'section-cover',
    },
    {
      id: 'u5-s04-meaning',
      title: 'Present Perfect: Meaning',
      layout: 'explain',
      sections: [
        {
          title: 'Meaning',
          content:
            'The Present Perfect talks about an action or experience that happened in the past but is still connected to the present.',
        },
        {
          title: 'Unit 5 context',
          content:
            'It is used to talk about things we have done, have never done, or have just completed.',
        },
        {
          title: 'Examples',
          content:
            'I have visited Ha Long Bay. She has joined a summer camp. We have never tried rock climbing.',
        },
      ],
    },
    {
      id: 'u5-s05-affirmative',
      title: 'Affirmative Form',
      layout: 'cards',
      cards: [
        {
          title: 'Formula',
          content: 'S + have / has + V3/ed.',
          example: 'I have visited an old village.',
        },
        {
          title: 'I / you / we / they',
          content: 'Use have.',
          example: 'We have taken many photos.',
        },
        {
          title: 'He / she / it',
          content: 'Use has.',
          example: 'She has joined a cooking class.',
        },
      ],
    },
    {
      id: 'u5-s06-negative',
      title: 'Negative Form',
      layout: 'explain',
      sections: [
        {
          title: 'Formula',
          content: 'S + have / has + not + V3/ed.',
        },
        {
          title: 'Short forms',
          content: "Have not = haven't. Has not = hasn't.",
        },
        {
          title: 'Examples',
          content:
            "I haven't visited Da Lat. She hasn't joined a school trip. They haven't tried camping before.",
        },
      ],
    },
    {
      id: 'u5-s07-yes-no',
      title: 'Yes / No Questions',
      layout: 'cards',
      cards: [
        {
          title: 'Formula',
          content: 'Have / Has + S + V3/ed?',
          example: 'Have you ever visited Hue?',
        },
        {
          title: 'Have',
          content: 'Use have with I, you, we, they.',
          example: 'Have they tried Vietnamese street food?',
        },
        {
          title: 'Has',
          content: 'Use has with he, she, it.',
          example: 'Has Nam taken part in a volunteer trip?',
        },
      ],
    },
    {
      id: 'u5-s08-short-answers',
      title: 'Short Answers',
      layout: 'cards',
      cards: [
        {
          title: 'Have you visited Hue?',
          content: "Yes, I have. / No, I haven't.",
          example: 'Have you visited Hue? Yes, I have.',
        },
        {
          title: 'Has she joined the trip?',
          content: "Yes, she has. / No, she hasn't.",
          example: "Has she joined the trip? No, she hasn't.",
        },
        {
          title: 'Have they tried camping?',
          content: "Yes, they have. / No, they haven't.",
          example: 'Have they tried camping? Yes, they have.',
        },
      ],
    },
    {
      id: 'u5-s09-wh-questions',
      title: 'Wh-Questions',
      layout: 'explain',
      sections: [
        {
          title: 'Formula',
          content: 'Wh-word + have / has + S + V3/ed?',
        },
        {
          title: 'Examples',
          content:
            'What have you done this summer? Where have you been? How many places have you visited?',
        },
        {
          title: 'Answer',
          content:
            'Use the Present Perfect when the experience is connected to now: I have joined a summer camp.',
        },
      ],
    },
    {
      id: 'u5-s10-experiences',
      title: 'Use 1: Past Experiences',
      layout: 'cards',
      cards: [
        {
          title: 'Experience',
          content: 'Talk about something someone has or has not done before.',
          example: 'I have visited a craft village.',
        },
        {
          title: 'New activity',
          content: 'Use Present Perfect for activities tried in life.',
          example: 'She has tried making pottery.',
        },
        {
          title: 'Never',
          content: 'Use never for experiences that have not happened.',
          example: 'They have never slept in a tent.',
        },
      ],
    },
    {
      id: 'u5-s11-unspecified-time',
      title: 'Use 2: No Specific Time',
      layout: 'explain',
      sections: [
        {
          title: 'Use',
          content:
            'Use Present Perfect when the exact past time is not mentioned or not important.',
        },
        {
          title: 'Examples',
          content:
            'I have read this book. He has seen this film. We have met many interesting people.',
        },
        {
          title: 'Focus',
          content: 'The focus is the experience or result, not the exact time.',
        },
      ],
    },
    {
      id: 'u5-s12-just',
      title: 'Use 3: Recent Actions with Just',
      layout: 'cards',
      cards: [
        {
          title: 'Just',
          content: 'Just means very recently.',
          example: 'I have just finished my project.',
        },
        {
          title: 'Position',
          content: 'Put just between have / has and V3.',
          example: 'They have just come back from the trip.',
        },
        {
          title: 'Experience writing',
          content: 'Use just for a newly completed action.',
          example: 'She has just written about her experience.',
        },
      ],
    },
    {
      id: 'u5-s13-already-yet',
      title: 'Use 4: Already and Yet',
      layout: 'explain',
      sections: [
        {
          title: 'Already',
          content:
            'Already means something has happened before now. It is common in affirmative sentences.',
        },
        {
          title: 'Yet',
          content:
            'Yet means until now. It is common in negative sentences and questions, usually at the end.',
        },
        {
          title: 'Examples',
          content:
            'I have already packed my bag. We have not finished the report yet. Have you written your travel diary yet?',
        },
      ],
    },
    {
      id: 'u5-s14-signal-words',
      title: 'Signal Words',
      layout: 'cards',
      cards: [
        {
          title: 'ever / never',
          content: 'Used to talk about life experiences.',
          example: 'Have you ever joined a camp? I have never tried kayaking.',
        },
        {
          title: 'already / yet / just',
          content: 'Used to talk about completed or recent actions.',
          example: 'We have just arrived. Have you finished it yet?',
        },
        {
          title: 'recently / so far / before',
          content: 'Used when the time is connected to the present.',
          example: 'I have visited two cities so far.',
        },
      ],
    },
    {
      id: 'u5-s15-ever',
      title: 'Ever',
      layout: 'explain',
      sections: [
        {
          title: 'Meaning',
          content: 'Ever means at any time in your life. It is often used in questions.',
        },
        {
          title: 'Formula',
          content: 'Have / Has + S + ever + V3/ed?',
        },
        {
          title: 'Examples',
          content:
            'Have you ever visited Hoi An? Has she ever tried local food? Have they ever joined a school trip?',
        },
      ],
    },
    {
      id: 'u5-s16-never',
      title: 'Never',
      layout: 'cards',
      cards: [
        {
          title: 'Meaning',
          content: 'Never means not at any time before now.',
          example: 'I have never climbed a mountain.',
        },
        {
          title: 'Formula',
          content: 'S + have / has + never + V3/ed.',
          example: 'She has never slept in a tent.',
        },
        {
          title: 'No extra not',
          content: 'Never already has a negative meaning.',
          example: 'Correct: I have never tried camping.',
        },
      ],
    },
    {
      id: 'u5-s17-already-yet-just',
      title: 'Already, Yet and Just',
      layout: 'cards',
      cards: [
        {
          title: 'Already',
          content: 'Already is common in affirmative sentences.',
          example: 'They have already taken many photos.',
        },
        {
          title: 'Yet',
          content: 'Yet is common in negatives and questions.',
          example: 'Has he joined the trip yet?',
        },
        {
          title: 'Just',
          content: 'Just usually stands between have / has and V3.',
          example: 'She has just come back from Da Nang.',
        },
      ],
    },
    {
      id: 'u5-s18-regular-v3',
      title: 'Past Participle: Regular Verbs',
      layout: 'cards',
      cards: [
        {
          title: 'visit',
          content: 'visited - visited',
          example: 'I have visited a museum.',
        },
        {
          title: 'join',
          content: 'joined - joined',
          example: 'She has joined a summer camp.',
        },
        {
          title: 'try',
          content: 'tried - tried',
          example: 'They have tried local food.',
        },
        {
          title: 'finish',
          content: 'finished - finished',
          example: 'We have finished our report.',
        },
      ],
    },
    {
      id: 'u5-s19-irregular-v3-1',
      title: 'Past Participle: Irregular Verbs 1',
      layout: 'cards',
      cards: [
        {
          title: 'be',
          content: 'was / were - been',
          example: 'I have been to Hue.',
        },
        {
          title: 'go',
          content: 'went - gone',
          example: 'She has gone to the museum.',
        },
        {
          title: 'see',
          content: 'saw - seen',
          example: 'We have seen this performance before.',
        },
        {
          title: 'take',
          content: 'took - taken',
          example: 'We have taken many photos.',
        },
      ],
    },
    {
      id: 'u5-s20-irregular-v3-2',
      title: 'Past Participle: Irregular Verbs 2',
      layout: 'cards',
      cards: [
        {
          title: 'write',
          content: 'wrote - written',
          example: 'He has written a diary about the trip.',
        },
        {
          title: 'eat',
          content: 'ate - eaten',
          example: 'They have eaten street food.',
        },
        {
          title: 'make',
          content: 'made - made',
          example: 'I have made many new friends.',
        },
        {
          title: 'come',
          content: 'came - come',
          example: 'We have just come back from our school trip.',
        },
      ],
    },
    {
      id: 'u5-s21-present-perfect-vs-past-simple',
      title: 'Present Perfect vs Past Simple',
      layout: 'cards',
      cards: [
        {
          title: 'Present Perfect',
          content: 'Use when the exact past time is not mentioned or not important.',
          example: 'I have visited Da Nang.',
        },
        {
          title: 'Past Simple',
          content: 'Use when the specific past time is mentioned.',
          example: 'I visited Da Nang last year.',
        },
        {
          title: 'Signal words',
          content:
            'Present Perfect: ever, never, just. Past Simple: yesterday, last year, ago, in 2020.',
          example: 'She joined a summer camp in 2023.',
        },
      ],
    },
    {
      id: 'u5-s22-no-specific-past-time',
      title: 'Do Not Use a Specific Past Time',
      layout: 'explain',
      sections: [
        {
          title: 'Common error',
          content:
            'Do not use a finished past time such as last year, yesterday, or in 2020 with Present Perfect.',
        },
        {
          title: 'Correct forms',
          content:
            'Wrong: I have visited Hue last year. Correct: I visited Hue last year. Correct: I have visited Hue before.',
        },
        {
          title: 'Reason',
          content: 'A specific finished past time usually needs Past Simple.',
        },
      ],
    },
    {
      id: 'u5-s23-common-errors',
      title: 'Common Mistakes',
      layout: 'cards',
      cards: [
        {
          title: 'Wrong V3',
          content: 'After have / has, use V3/ed.',
          example: 'Correct: She has gone to Da Nang.',
        },
        {
          title: 'Wrong auxiliary',
          content: 'Use have or has according to the subject.',
          example: 'Correct: He has joined the trip. They have visited the museum.',
        },
        {
          title: 'Double negative',
          content: 'Do not use not with never.',
          example: 'Correct: I have never tried camping.',
        },
      ],
    },
    {
      id: 'u5-s24-detailed-examples',
      title: 'Detailed Examples',
      layout: 'explain',
      sections: [
        {
          title: 'Example 1',
          content:
            'I have visited Hoi An. The speaker talks about an experience, not a specific time.',
        },
        {
          title: 'Example 2',
          content: 'Have you ever joined a summer camp? Ever is used to ask about life experience.',
        },
        {
          title: 'Example 3',
          content:
            'We have just come back from our school trip. Just shows that the action happened very recently.',
        },
      ],
    },
    {
      id: 'u5-s25-practice-have-has',
      title: 'Practice 1: Have or Has',
      layout: 'practice',
      sections: [
        {
          title: 'I ___ visited an old village.',
          example: 'have',
        },
        {
          title: 'She ___ joined a cooking class.',
          example: 'has',
        },
        {
          title: 'They ___ tried camping before.',
          example: 'have',
        },
        {
          title: 'Nam ___ taken part in a volunteer trip.',
          example: 'has',
        },
      ],
    },
    {
      id: 'u5-s26-practice-signal-words',
      title: 'Practice 2: Choose the Signal Word',
      layout: 'practice',
      sections: [
        {
          title: 'Have you ___ visited Hue? (ever / never)',
          example: 'ever',
        },
        {
          title: 'I have ___ climbed a mountain. (yet / never)',
          example: 'never',
        },
        {
          title: 'We have ___ arrived at the campsite. (just / yet)',
          example: 'just',
        },
        {
          title: 'Have you finished your travel diary ___? (already / yet)',
          example: 'yet',
        },
      ],
    },
    {
      id: 'u5-s27-practice-fix-errors',
      title: 'Practice 3: Fix the Mistakes',
      layout: 'practice',
      sections: [
        {
          title: 'I have visited Hue last year.',
          example: 'I visited Hue last year. / I have visited Hue before.',
        },
        {
          title: 'She has go to Da Nang.',
          example: 'She has gone to Da Nang.',
        },
        {
          title: 'They has visited the museum.',
          example: 'They have visited the museum.',
        },
        {
          title: "I haven't never tried camping.",
          example: 'I have never tried camping.',
        },
      ],
    },
    {
      id: 'u5-s28-vocab-cover',
      title: 'II. Vocabulary: Our Experiences',
      subtitle: 'Từ vựng về những trải nghiệm',
      layout: 'section-cover',
    },
    {
      id: 'u5-s29-vocab-experiences',
      title: 'Types of Experiences',
      layout: 'cards',
      cards: [
        {
          title: 'experience',
          content: 'trải nghiệm',
          example: 'This was a memorable experience.',
        },
        {
          title: 'school trip',
          content: 'chuyến đi của trường',
          example: 'We have joined a school trip.',
        },
        {
          title: 'summer camp',
          content: 'trại hè',
          example: 'She has joined a summer camp.',
        },
        {
          title: 'volunteer trip',
          content: 'chuyến đi tình nguyện',
          example: 'They have joined a volunteer trip.',
        },
      ],
    },
    {
      id: 'u5-s30-vocab-activities',
      title: 'Experience Activities',
      layout: 'cards',
      cards: [
        {
          title: 'climb a mountain',
          content: 'leo núi',
          example: 'Have you ever climbed a mountain?',
        },
        {
          title: 'go camping',
          content: 'đi cắm trại',
          example: 'We have gone camping twice.',
        },
        {
          title: 'try local food',
          content: 'thử món ăn địa phương',
          example: 'They have tried local food.',
        },
        {
          title: 'make new friends',
          content: 'kết bạn mới',
          example: 'I have made many new friends.',
        },
      ],
    },
    {
      id: 'u5-s31-vocab-feelings',
      title: 'Feelings about Experiences',
      layout: 'cards',
      cards: [
        {
          title: 'unforgettable',
          content: 'không thể quên',
          example: 'It was an unforgettable experience.',
        },
        {
          title: 'challenging',
          content: 'nhiều thử thách',
          example: 'Climbing the mountain was challenging.',
        },
        {
          title: 'meaningful',
          content: 'có ý nghĩa',
          example: 'The volunteer trip was meaningful.',
        },
        {
          title: 'embarrassing',
          content: 'xấu hổ',
          example: 'It was an embarrassing moment.',
        },
      ],
    },
    {
      id: 'u5-s32-vocab-verbs',
      title: 'Useful Verbs for Experiences',
      layout: 'cards',
      cards: [
        {
          title: 'take part in',
          content: 'tham gia',
          example: 'He has taken part in a contest.',
        },
        {
          title: 'explore',
          content: 'khám phá',
          example: 'We have explored an old village.',
        },
        {
          title: 'remember',
          content: 'nhớ',
          example: 'I will remember this trip forever.',
        },
        {
          title: 'share',
          content: 'chia sẻ',
          example: 'She has shared her experience with us.',
        },
      ],
    },
    {
      id: 'u5-s33-comm-ever',
      title: 'Communication: Asking about Experiences',
      layout: 'explain',
      sections: [
        {
          title: 'Formula',
          content: 'Have / Has + S + ever + V3/ed?',
        },
        {
          title: 'Examples',
          content:
            'Have you ever joined a summer camp? Have you ever visited Hoi An? Has she ever tried local food?',
        },
        {
          title: 'Use',
          content:
            'Use this question to ask whether someone has had an experience at any time before now.',
        },
      ],
    },
    {
      id: 'u5-s34-comm-done',
      title: 'Communication: Saying What You Have Done',
      layout: 'cards',
      cards: [
        {
          title: 'Formula',
          content: 'S + have / has + V3/ed.',
          example: 'I have visited Da Nang.',
        },
        {
          title: 'School trip',
          content: 'Talk about a completed experience.',
          example: 'She has joined a school trip.',
        },
        {
          title: 'Volunteer project',
          content: 'Talk about participation.',
          example: 'We have taken part in a volunteer project.',
        },
      ],
    },
    {
      id: 'u5-s35-comm-never',
      title: 'Communication: Saying What You Have Never Done',
      layout: 'explain',
      sections: [
        {
          title: 'Formula',
          content: 'S + have / has + never + V3/ed.',
        },
        {
          title: 'Examples',
          content:
            'I have never gone camping. He has never climbed a mountain. We have never tried kayaking.',
        },
        {
          title: 'Note',
          content: 'Never already means not ever, so do not add not.',
        },
      ],
    },
    {
      id: 'u5-s36-memorable-experience',
      title: 'Communication: A Memorable Experience',
      layout: 'cards',
      cards: [
        {
          title: 'Question',
          content: 'What is the most memorable experience you have ever had?',
          example: 'What is the most memorable experience you have ever had?',
        },
        {
          title: 'Answer 1',
          content: 'The most memorable experience I have ever had is ...',
          example: 'The most memorable experience I have ever had is joining a summer camp.',
        },
        {
          title: 'Answer 2',
          content: 'I have had many experiences, but ... was the best.',
          example: 'I have had many experiences, but my school trip to Hue was the best.',
        },
      ],
    },
    {
      id: 'u5-s37-mini-dialogue',
      title: 'Mini Dialogue',
      layout: 'explain',
      sections: [
        {
          title: 'A',
          content: 'Have you ever joined a summer camp?',
        },
        {
          title: 'B',
          content: 'Yes, I have. I joined one last summer, and it was unforgettable.',
        },
        {
          title: 'A',
          content: 'What have you learned from it?',
        },
        {
          title: 'B',
          content: 'I have learned how to make new friends and work in a team.',
        },
      ],
    },
    {
      id: 'u5-s38-sentence-building',
      title: 'Practice 4: Build Sentences',
      layout: 'practice',
      sections: [
        {
          title: 'you / ever / climb / a mountain?',
          example: 'Have you ever climbed a mountain?',
        },
        {
          title: 'she / never / sleep / in a tent',
          example: 'She has never slept in a tent.',
        },
        {
          title: 'we / just / come back / from the trip',
          example: 'We have just come back from the trip.',
        },
        {
          title: 'they / already / take / many photos',
          example: 'They have already taken many photos.',
        },
      ],
    },
    {
      id: 'u5-s39-exam-practice',
      title: 'Exam-Style Practice',
      layout: 'practice',
      sections: [
        {
          title: 'Choose: She ___ a summer camp. A. has joined B. have joined C. has join',
          example: 'A. has joined',
        },
        {
          title: 'Choose: Have you finished your diary ___? A. already B. yet C. never',
          example: 'B. yet',
        },
        {
          title: 'Choose: I ___ Da Nang last summer. A. have visited B. visited C. has visited',
          example: 'B. visited',
        },
        {
          title: 'Complete: We have ___ tried kayaking before.',
          example: 'never',
        },
      ],
    },
    {
      id: 'u5-s40-summary',
      title: 'Unit 5 Summary',
      layout: 'outline',
      bullets: [
        { content: 'Present Perfect: S + have / has + V3/ed.' },
        {
          content:
            'Use it for experiences, unspecified past actions, and recent completed actions.',
        },
        { content: 'Ever asks about experiences; never means not at any time before now.' },
        {
          content:
            'Already is common in affirmative sentences; yet is common in negatives and questions.',
        },
        { content: 'Just means very recently.' },
        { content: 'Use Past Simple with specific finished past time expressions.' },
      ],
    },
  ],
};

export default deck;
