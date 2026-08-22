import { LessonDeck } from '../../../types';

const deck: LessonDeck = {
  id: 'gs-g9-u7-natural-wonders',
  curriculumFamily: 'global-success',
  grade: 9,
  unitNumber: 7,
  title: 'Grammar Grade 9 - Unit 7: Natural Wonders',
  description:
    'Bài giảng Unit 7 Global Success 9 về reported speech for Yes / No questions và từ vựng Natural Wonders.',
  createdAt: '2026-05-18T00:00:00.000Z',
  slides: [
    {
      id: 's1',
      title: 'GRAMMAR GRADE 9',
      subtitle: 'UNIT 7: NATURAL WONDERS',
      label: 'NỘI DUNG BÀI HỌC:',
      layout: 'outline',
      cards: [
        {
          title: 'REPORTED SPEECH FOR YES / NO QUESTIONS',
          subtitle: '(Câu tường thuật cho câu hỏi Yes / No)',
          accent: 'blue',
        },
        {
          title: 'IF / WHETHER',
          subtitle: '(Liệu rằng / có phải là... không)',
          accent: 'green',
        },
        {
          title: 'NATURAL WONDERS VOCABULARY',
          subtitle: '(Từ vựng kỳ quan thiên nhiên)',
          accent: 'orange',
        },
      ],
    },
    {
      id: 's2',
      title: 'Mục tiêu bài học',
      layout: 'objectives',
      bullets: [
        { content: 'Chuyển câu hỏi Yes / No trực tiếp sang câu tường thuật với if hoặc whether.' },
        { content: 'Đổi trật tự câu hỏi thành trật tự câu khẳng định trong reported questions.' },
        { content: 'Lùi thì, đổi đại từ, đổi trạng từ thời gian và nơi chốn khi cần.' },
        { content: 'Dùng từ vựng về natural wonders để đặt câu hỏi và tường thuật câu hỏi.' },
      ],
    },
    {
      id: 's3',
      title: 'Reported Speech là gì?',
      subtitle: 'Câu tường thuật dùng để thuật lại lời nói hoặc câu hỏi của người khác.',
      layout: 'cards',
      cards: [
        {
          title: 'Direct question',
          accent: 'blue',
          content: '“Is Ha Long Bay a natural wonder?” she asked.',
        },
        {
          title: 'Reported question',
          accent: 'green',
          content: 'She asked if Ha Long Bay was a natural wonder.',
        },
        {
          title: 'Ý nghĩa',
          accent: 'orange',
          content: 'Cô ấy hỏi liệu Vịnh Hạ Long có phải là một kỳ quan thiên nhiên không.',
        },
      ],
    },
    {
      id: 's4',
      title: 'Yes / No questions trực tiếp',
      subtitle: 'Câu hỏi Yes / No thường bắt đầu bằng be, do, have hoặc modal verbs.',
      layout: 'cards',
      cards: [
        {
          title: 'Be',
          accent: 'blue',
          content: 'Is / Are + S + ...?',
          example: 'Is it famous?',
        },
        {
          title: 'Do / Does / Did',
          accent: 'green',
          content: 'Do / Does / Did + S + V?',
          example: 'Do many tourists visit it?',
        },
        {
          title: 'Have / Has',
          accent: 'purple',
          content: 'Have / Has + S + V3?',
          example: 'Have you ever been there?',
        },
        {
          title: 'Modal verbs',
          accent: 'orange',
          content: 'Can / Will / Must + S + V?',
          example: 'Can visitors swim there?',
        },
      ],
    },
    {
      id: 's5',
      title: 'Công thức chung',
      subtitle: 'Reported Yes / No questions dùng if hoặc whether.',
      layout: 'explain',
      accent: 'blue',
      formula: 'S + asked / wanted to know / wondered + if / whether + S + V lùi thì',
      bullets: [
        { content: 'Bỏ dấu hỏi và dùng dấu chấm.' },
        { content: 'Thêm if hoặc whether vì câu hỏi trực tiếp không có Wh-word.' },
        { content: 'Không đảo trợ động từ lên trước chủ ngữ trong mệnh đề tường thuật.' },
      ],
      examples: [
        'He asked if the Grand Canyon was in the USA.',
        'She asked whether many tourists visited Ha Long Bay.',
        'They asked if they could explore the cave.',
      ],
    },
    {
      id: 's6',
      title: 'If và Whether',
      subtitle: 'Cả hai đều có nghĩa là liệu rằng / có phải là... không.',
      layout: 'cards',
      cards: [
        {
          title: 'If',
          accent: 'blue',
          content: 'She asked if I liked natural wonders.',
        },
        {
          title: 'Whether',
          accent: 'green',
          content: 'She asked whether I liked natural wonders.',
        },
        {
          title: 'Ghi nhớ',
          accent: 'orange',
          content:
            'Trong bài tập Yes / No reported questions, if và whether thường có thể thay thế nhau.',
        },
      ],
    },
    {
      id: 's7',
      title: '4 bước chuyển câu',
      subtitle: 'Dùng quy trình này cho mọi câu hỏi Yes / No.',
      layout: 'cards',
      cards: [
        {
          title: 'Bước 1',
          accent: 'blue',
          content: 'Bỏ dấu hỏi.',
          example: 'Is the cave deep? -> if the cave was deep.',
        },
        {
          title: 'Bước 2',
          accent: 'green',
          content: 'Thêm if / whether.',
          example: 'She asked if I liked waterfalls.',
        },
        {
          title: 'Bước 3',
          accent: 'orange',
          content: 'Đổi về trật tự câu khẳng định.',
          example: 'if Ha Long Bay was beautiful',
        },
        {
          title: 'Bước 4',
          accent: 'purple',
          content: 'Lùi thì nếu reporting verb ở quá khứ.',
          example: 'can -> could, is -> was, do -> V2/ed',
        },
      ],
    },
    {
      id: 's8',
      title: 'Không giữ trật tự câu hỏi',
      subtitle: 'Trong reported question, chủ ngữ đứng trước động từ.',
      layout: 'cards',
      cards: [
        {
          title: 'Sai',
          accent: 'red',
          content: 'She asked if was Ha Long Bay beautiful.',
        },
        {
          title: 'Đúng',
          accent: 'green',
          content: 'She asked if Ha Long Bay was beautiful.',
        },
        {
          title: 'Sai',
          accent: 'red',
          content: 'He asked if did I visit the cave.',
        },
        {
          title: 'Đúng',
          accent: 'green',
          content: 'He asked if I visited the cave.',
        },
      ],
    },
    {
      id: 's9',
      title: 'Quy tắc lùi thì',
      subtitle: 'Khi asked / wondered / wanted to know ở quá khứ, mệnh đề sau thường lùi thì.',
      layout: 'cards',
      cards: [
        {
          title: 'Be',
          accent: 'blue',
          content: 'am / is / are -> was / were',
          example: 'Is the cave deep? -> if the cave was deep',
        },
        {
          title: 'Present Simple',
          accent: 'green',
          content: 'do / does + V -> V2/ed',
          example: 'Do tourists visit it? -> if tourists visited it',
        },
        {
          title: 'Past Simple',
          accent: 'orange',
          content: 'did + V -> had + V3/ed',
          example: 'Did you visit it? -> if I had visited it',
        },
        {
          title: 'Modal verbs',
          accent: 'purple',
          content: 'can -> could, will -> would, must -> had to',
          example: 'Can we swim? -> if we could swim',
        },
      ],
    },
    {
      id: 's10',
      title: 'Câu hỏi với Be',
      subtitle: 'Is / Are chuyển thành was / were sau asked.',
      layout: 'explain',
      accent: 'blue',
      formula: 'S + asked + if / whether + S + was / were + ...',
      bullets: [
        { content: 'Is + singular subject chuyển thành was.' },
        { content: 'Are + plural subject chuyển thành were.' },
        { content: 'This thường đổi thành that nếu ngữ cảnh thay đổi.' },
      ],
      examples: [
        '“Is the waterfall high?” he asked. -> He asked if the waterfall was high.',
        '“Are the mountains dangerous?” she asked. -> She asked whether the mountains were dangerous.',
        '“Is this cave famous?” Nam asked. -> Nam asked if that cave was famous.',
      ],
    },
    {
      id: 's11',
      title: 'Câu hỏi với Do / Does',
      subtitle: 'Do / Does biến mất, động từ chính chuyển sang quá khứ.',
      layout: 'explain',
      accent: 'green',
      formula: 'S + asked + if / whether + S + V2/ed',
      bullets: [
        { content: 'Không giữ do / does trong câu tường thuật.' },
        { content: 'Động từ chính chuyển sang V2/ed.' },
        { content: 'Here có thể đổi thành there.' },
      ],
      examples: [
        '“Do many people visit the island?” -> She asked if many people visited the island.',
        '“Does the tour guide speak English?” -> He asked whether the tour guide spoke English.',
        '“Do tourists take photos here?” -> Lan asked if tourists took photos there.',
      ],
    },
    {
      id: 's12',
      title: 'Câu hỏi với Did',
      subtitle: 'Did + V chuyển thành had + V3/ed.',
      layout: 'explain',
      accent: 'orange',
      formula: 'S + asked + if / whether + S + had + V3/ed',
      bullets: [
        { content: 'Did không xuất hiện trong reported question.' },
        { content: 'Động từ chính chuyển thành had + V3/ed.' },
        { content: 'Yesterday đổi thành the day before / the previous day.' },
      ],
      examples: [
        '“Did you visit Ha Long Bay last year?” -> He asked if I had visited Ha Long Bay the year before.',
        '“Did they explore the cave yesterday?” -> She asked whether they had explored the cave the day before.',
        '“Did your family go to the beach?” -> Nam asked if my family had gone to the beach.',
      ],
    },
    {
      id: 's13',
      title: 'Câu hỏi với Have / Has',
      subtitle: 'Present Perfect chuyển thành Past Perfect.',
      layout: 'explain',
      accent: 'purple',
      formula: 'S + asked + if / whether + S + had + V3/ed',
      bullets: [
        { content: 'Have / has + V3 chuyển thành had + V3.' },
        { content: 'Ever thường giữ nguyên.' },
        { content: 'Dùng cho trải nghiệm đã từng tham quan kỳ quan thiên nhiên.' },
      ],
      examples: [
        '“Have you ever visited a natural wonder?” -> She asked if I had ever visited a natural wonder.',
        '“Has he seen the Great Barrier Reef?” -> They asked whether he had seen the Great Barrier Reef.',
      ],
    },
    {
      id: 's14',
      title: 'Câu hỏi với Modal verbs',
      subtitle: 'Modal verbs thường lùi thì trong reported speech.',
      layout: 'cards',
      cards: [
        {
          title: 'Can',
          accent: 'blue',
          content: 'Can + S + V? -> if + S + could + V',
          example: 'They asked if they could climb the mountain.',
        },
        {
          title: 'Will',
          accent: 'green',
          content: 'Will + S + V? -> whether + S + would + V',
          example: 'She asked whether the tour would start early.',
        },
        {
          title: 'Must',
          accent: 'orange',
          content: 'Must + S + V? -> if + S + had to + V',
          example: 'He asked if visitors had to wear life jackets.',
        },
      ],
    },
    {
      id: 's15',
      title: 'Đổi đại từ',
      subtitle: 'Đại từ thay đổi theo người nói và người nghe.',
      layout: 'cards',
      cards: [
        {
          title: 'I / my',
          accent: 'blue',
          content: 'I -> he / she; my -> his / her',
          example: 'He asked me if I had seen his camera.',
        },
        {
          title: 'We / our',
          accent: 'green',
          content: 'we -> they; our -> their',
          example: 'They asked if they could visit the island.',
        },
        {
          title: 'You',
          accent: 'purple',
          content: 'You đổi theo ngữ cảnh: I, we, he, she, they.',
          example: 'She asked me if I liked that cave.',
        },
      ],
    },
    {
      id: 's16',
      title: 'Đổi thời gian và nơi chốn',
      subtitle: 'Các từ chỉ thời gian / nơi chốn thường đổi khi ngữ cảnh thay đổi.',
      layout: 'cards',
      cards: [
        {
          title: 'Time',
          accent: 'orange',
          content: 'today -> that day, yesterday -> the day before, tomorrow -> the next day',
          example: 'He asked if I had visited the cave the day before.',
        },
        {
          title: 'Place',
          accent: 'green',
          content: 'here -> there, this -> that, these -> those',
          example: 'He asked if that island was safe.',
        },
        {
          title: 'Week',
          accent: 'blue',
          content: 'last week -> the previous week, next week -> the following week',
          example: 'She asked whether they would go there the following week.',
        },
      ],
    },
    {
      id: 's17',
      title: 'Reporting verbs',
      subtitle: 'Một số động từ tường thuật thường dùng.',
      layout: 'cards',
      cards: [
        {
          title: 'asked',
          accent: 'blue',
          content: 'hỏi',
          example: 'She asked if I liked the cave.',
        },
        {
          title: 'wanted to know',
          accent: 'green',
          content: 'muốn biết',
          example: 'He wanted to know whether the tour was safe.',
        },
        {
          title: 'wondered',
          accent: 'purple',
          content: 'tự hỏi / băn khoăn',
          example: 'They wondered if they could visit the island.',
        },
      ],
    },
    {
      id: 's18',
      title: 'Khi nào có thể không lùi thì?',
      subtitle: 'Với sự thật hiển nhiên, đôi khi có thể giữ thì hiện tại.',
      layout: 'explain',
      accent: 'green',
      formula: 'asked if + fact + is / was ...',
      bullets: [
        {
          content:
            'Nếu câu nói vẫn đúng ở hiện tại hoặc là sự thật hiển nhiên, có thể không lùi thì.',
        },
        {
          content:
            'Trong bài tập ngữ pháp ở trường, thường ưu tiên lùi thì khi reporting verb là asked.',
        },
      ],
      examples: [
        '“Is Mount Everest the highest mountain in the world?” he asked.',
        'He asked if Mount Everest is / was the highest mountain in the world.',
      ],
    },
    {
      id: 's19',
      title: 'Lỗi thường gặp',
      subtitle: 'Các lỗi dễ mất điểm khi viết reported questions.',
      layout: 'cards',
      cards: [
        {
          title: 'Quên if / whether',
          accent: 'red',
          content: 'Sai: She asked me I liked Ha Long Bay.',
          example: 'Đúng: She asked me if I liked Ha Long Bay.',
        },
        {
          title: 'Giữ trật tự câu hỏi',
          accent: 'red',
          content: 'Sai: He asked if was the cave deep.',
          example: 'Đúng: He asked if the cave was deep.',
        },
        {
          title: 'Dùng did',
          accent: 'red',
          content: 'Sai: He asked if I did visit the cave.',
          example: 'Đúng: He asked if I visited the cave.',
        },
      ],
    },
    {
      id: 's20',
      title: 'Ví dụ minh họa',
      subtitle: 'Phân tích từng bước chuyển câu.',
      layout: 'cards',
      cards: [
        {
          title: 'Be',
          accent: 'blue',
          content: '“Is Ha Long Bay in Viet Nam?” he asked.',
          example: 'He asked if Ha Long Bay was in Viet Nam.',
        },
        {
          title: 'Do',
          accent: 'green',
          content: '“Do many tourists visit this cave?” she asked.',
          example: 'She asked whether many tourists visited that cave.',
        },
        {
          title: 'Can',
          accent: 'purple',
          content: '“Can we swim in the lake?” they asked.',
          example: 'They asked if they could swim in the lake.',
        },
        {
          title: 'Did',
          accent: 'orange',
          content: '“Did you explore the forest yesterday?” Nam asked me.',
          example: 'Nam asked me if I had explored the forest the day before.',
        },
      ],
    },
    {
      id: 's21',
      title: 'Bảng tóm tắt chuyển đổi',
      subtitle: 'Nhìn từ mở đầu câu hỏi trực tiếp để chọn cấu trúc tường thuật.',
      layout: 'cards',
      cards: [
        {
          title: 'Is / Are',
          accent: 'blue',
          content: 'asked if / whether + S + was / were',
          example: 'Is it famous? -> if it was famous',
        },
        {
          title: 'Do / Does',
          accent: 'green',
          content: 'asked if / whether + S + V2/ed',
          example: 'Do tourists visit it? -> if tourists visited it',
        },
        {
          title: 'Did / Have',
          accent: 'orange',
          content: 'asked if / whether + S + had + V3/ed',
          example: 'Did you visit it? -> if I had visited it',
        },
        {
          title: 'Can / Will / Must',
          accent: 'purple',
          content: 'could / would / had to + V',
          example: 'Can we climb? -> if we could climb',
        },
      ],
    },
    {
      id: 's22',
      title: 'Cấu trúc giao tiếp thường gặp',
      subtitle: 'Dùng với câu hỏi về kỳ quan thiên nhiên.',
      layout: 'cards',
      cards: [
        {
          title: 'Natural wonder',
          accent: 'blue',
          content: '“Is + place + a natural wonder?”',
          example: 'She asked if Ha Long Bay was a natural wonder.',
        },
        {
          title: 'Visitors can do',
          accent: 'green',
          content: '“Can visitors / tourists + V?”',
          example: 'He asked whether tourists could explore the cave.',
        },
        {
          title: 'Experience',
          accent: 'purple',
          content: '“Have you ever visited + place?”',
          example: 'Lan asked me if I had ever visited the Grand Canyon.',
        },
      ],
    },
    {
      id: 's23',
      title: 'Từ vựng: Kỳ quan thiên nhiên',
      subtitle: 'Các địa danh và dạng cảnh quan tự nhiên.',
      layout: 'cards',
      cards: [
        {
          title: 'Water and land',
          accent: 'blue',
          content: 'bay, lake, island, valley, desert',
          example: 'Ha Long Bay is a natural wonder.',
        },
        {
          title: 'High and deep places',
          accent: 'green',
          content: 'cave, mountain, waterfall, canyon',
          example: 'The cave is very deep.',
        },
        {
          title: 'Ecosystems',
          accent: 'orange',
          content: 'rainforest, reef',
          example: 'The Great Barrier Reef is in Australia.',
        },
      ],
    },
    {
      id: 's24',
      title: 'Từ vựng: Hoạt động du lịch thiên nhiên',
      subtitle: 'Dùng để hỏi và tường thuật trải nghiệm tham quan.',
      layout: 'cards',
      cards: [
        {
          title: 'Travel actions',
          accent: 'blue',
          content: 'visit, explore, climb, swim, take photos',
          example: 'Many tourists visit the cave.',
        },
        {
          title: 'Outdoor activities',
          accent: 'green',
          content: 'go hiking, go camping',
          example: 'We went hiking in the mountains.',
        },
        {
          title: 'Protection',
          accent: 'orange',
          content: 'protect, preserve, damage',
          example: 'People should preserve the rainforest.',
        },
      ],
    },
    {
      id: 's25',
      title: 'Từ vựng: Tính từ miêu tả',
      subtitle: 'Dùng để trả lời hoặc tường thuật câu hỏi về kỳ quan.',
      layout: 'cards',
      cards: [
        {
          title: 'Beauty',
          accent: 'blue',
          content: 'beautiful, amazing, breathtaking, peaceful, unique',
          example: 'The view is breathtaking.',
        },
        {
          title: 'Size and shape',
          accent: 'green',
          content: 'deep, high, large',
          example: 'The waterfall is high.',
        },
        {
          title: 'Safety',
          accent: 'orange',
          content: 'dangerous, protected, mysterious',
          example: 'The mountain can be dangerous.',
        },
      ],
    },
    {
      id: 's26',
      title: 'Luyện tập 1: Chuyển câu với Be',
      subtitle: 'Đổi câu hỏi trực tiếp sang câu tường thuật.',
      layout: 'practice',
      accent: 'blue',
      sections: [
        {
          title: 'Câu 1',
          content: '“Is the cave deep?” he asked.',
          example: 'He asked if the cave was deep.',
        },
        {
          title: 'Câu 2',
          content: '“Are the mountains dangerous?” she asked.',
          example: 'She asked whether the mountains were dangerous.',
        },
        {
          title: 'Câu 3',
          content: '“Is this island safe?” he asked.',
          example: 'He asked if that island was safe.',
        },
      ],
    },
    {
      id: 's27',
      title: 'Luyện tập 2: Do / Does / Did',
      subtitle: 'Chú ý bỏ do / does / did và lùi thì.',
      layout: 'practice',
      accent: 'green',
      sections: [
        {
          title: 'Do',
          content: '“Do many people visit the island?” she asked.',
          example: 'She asked if many people visited the island.',
        },
        {
          title: 'Does',
          content: '“Does the tour guide speak English?” he asked.',
          example: 'He asked whether the tour guide spoke English.',
        },
        {
          title: 'Did',
          content: '“Did they explore the cave yesterday?” she asked.',
          example: 'She asked whether they had explored the cave the day before.',
        },
      ],
    },
    {
      id: 's28',
      title: 'Luyện tập 3: Have / Modal verbs',
      subtitle: 'Present Perfect và modal verbs trong reported questions.',
      layout: 'practice',
      accent: 'purple',
      sections: [
        {
          title: 'Have',
          content: '“Have you ever visited a natural wonder?” she asked.',
          example: 'She asked if I had ever visited a natural wonder.',
        },
        {
          title: 'Can',
          content: '“Can we climb the mountain?” they asked.',
          example: 'They asked if they could climb the mountain.',
        },
        {
          title: 'Will',
          content: '“Will the tour start early?” she asked.',
          example: 'She asked whether the tour would start early.',
        },
      ],
    },
    {
      id: 's29',
      title: 'Luyện tập 4: Sửa lỗi sai',
      subtitle: 'Tìm lỗi và viết lại câu đúng.',
      layout: 'practice',
      accent: 'red',
      sections: [
        {
          title: 'Lỗi 1',
          content: 'She asked me I liked Ha Long Bay.',
          example: 'She asked me if I liked Ha Long Bay.',
        },
        {
          title: 'Lỗi 2',
          content: 'He asked if was the cave deep.',
          example: 'He asked if the cave was deep.',
        },
        {
          title: 'Lỗi 3',
          content: 'He asked if I did visit the cave.',
          example: 'He asked if I visited the cave.',
        },
      ],
    },
    {
      id: 's30',
      title: 'Tổng kết Unit 7',
      subtitle: 'Reported Speech for Yes / No Questions',
      layout: 'practice',
      accent: 'blue',
      sections: [
        {
          title: 'Công thức',
          content: 'S + asked / wanted to know / wondered + if / whether + S + V lùi thì.',
          example: 'She asked if Ha Long Bay was a natural wonder.',
        },
        {
          title: 'Trật tự câu',
          content: 'Reported question dùng trật tự câu khẳng định, không đảo trợ động từ.',
          example: 'He asked if the cave was deep.',
        },
        {
          title: 'Cần đổi',
          content: 'Đổi thì, đại từ, trạng từ thời gian / nơi chốn khi ngữ cảnh thay đổi.',
          example: 'Yesterday -> the day before, this -> that, can -> could.',
        },
      ],
    },
  ],
};

export default deck;
