import { LessonDeck } from '../../../types';

const deck: LessonDeck = {
  id: 'gs-g7-u10-energy-sources',
  curriculumFamily: 'global-success',
  grade: 7,
  unitNumber: 10,
  title: 'Grammar Grade 7 - Unit 10: Energy Sources',
  description:
    'Bài giảng Unit 10 Global Success 7 về The Present Continuous và từ vựng chủ đề Energy Sources.',
  createdAt: '2026-05-18T00:00:00.000Z',
  slides: [
    {
      id: 's1',
      title: 'GRAMMAR GRADE 7',
      subtitle: 'UNIT 10: ENERGY SOURCES',
      label: 'NỘI DUNG BÀI HỌC:',
      layout: 'outline',
      cards: [
        {
          title: 'THE PRESENT CONTINUOUS',
          subtitle: '(Thì hiện tại tiếp diễn)',
          accent: 'orange',
        },
        {
          title: 'ENERGY SOURCES',
          subtitle: '(Nguồn năng lượng)',
          accent: 'blue',
        },
        {
          title: 'ENERGY-SAVING LANGUAGE',
          subtitle: '(Cấu trúc nói về tiết kiệm năng lượng)',
          accent: 'green',
        },
      ],
    },
    {
      id: 's2',
      title: 'Mục tiêu bài học',
      layout: 'objectives',
      bullets: [
        { content: 'Dùng Present Continuous để nói hành động đang xảy ra hoặc xu hướng hiện nay.' },
        { content: 'Chia đúng am / is / are + V-ing trong câu khẳng định, phủ định và nghi vấn.' },
        { content: 'Nhận biết dấu hiệu như now, at the moment, these days, currently.' },
        { content: 'Nói về việc sử dụng, tiết kiệm và phát triển các nguồn năng lượng.' },
      ],
    },
    {
      id: 's3',
      title: 'Phần 1',
      subtitle: 'The Present Continuous',
      layout: 'section-cover',
      accent: 'orange',
    },
    {
      id: 's4',
      title: 'Present Continuous là gì?',
      subtitle: 'Dùng để nói việc đang xảy ra hoặc đang diễn ra trong giai đoạn hiện tại.',
      layout: 'explain',
      accent: 'orange',
      formula: 'S + am / is / are + V-ing',
      bullets: [
        { content: 'Diễn tả hành động đang xảy ra ngay lúc nói.' },
        { content: 'Diễn tả sự việc hoặc xu hướng đang diễn ra hiện nay.' },
        { content: 'Có thể dùng cho kế hoạch tương lai gần đã được sắp xếp.' },
      ],
      examples: [
        'People are using more renewable energy.',
        'Scientists are developing new energy sources.',
        'We are saving electricity at home.',
      ],
    },
    {
      id: 's5',
      title: 'Câu khẳng định',
      subtitle: 'Chọn đúng am / is / are theo chủ ngữ.',
      layout: 'cards',
      cards: [
        {
          title: 'I',
          accent: 'orange',
          content: 'I + am + V-ing',
          example: 'I am saving energy.',
        },
        {
          title: 'He / She / It',
          accent: 'pink',
          content: 'He / She / It + is + V-ing',
          example: 'She is using solar power.',
        },
        {
          title: 'You / We / They',
          accent: 'blue',
          content: 'You / We / They + are + V-ing',
          example: 'They are building a wind farm.',
        },
      ],
    },
    {
      id: 's6',
      title: 'Phủ định và nghi vấn',
      subtitle: 'Dùng not để phủ định; đảo am / is / are để hỏi.',
      layout: 'cards',
      cards: [
        {
          title: 'Phủ định',
          accent: 'pink',
          content: 'S + am / is / are + not + V-ing',
          example: 'She isn’t using coal.',
        },
        {
          title: 'Yes / No question',
          accent: 'blue',
          content: 'Am / Is / Are + S + V-ing?',
          example: 'Are they building a wind farm?',
        },
        {
          title: 'Trả lời ngắn',
          accent: 'green',
          content: 'Yes, S + am/is/are. / No, S + am/is/are not.',
          example: 'Yes, they are. / No, they aren’t.',
        },
      ],
    },
    {
      id: 's7',
      title: 'Wh-questions',
      subtitle: 'Hỏi thông tin cụ thể về việc đang làm.',
      layout: 'cards',
      cards: [
        {
          title: 'Công thức',
          accent: 'orange',
          content: 'Wh-word + am / is / are + S + V-ing?',
          example: 'What are you doing to save energy?',
        },
        {
          title: 'Hỏi nơi chốn',
          accent: 'blue',
          content: 'Where + am / is / are + S + V-ing?',
          example: 'Where are they building the wind farm?',
        },
        {
          title: 'Hỏi cách thức',
          accent: 'green',
          content: 'How + am / is / are + S + V-ing?',
          example: 'How are people reducing pollution?',
        },
      ],
    },
    {
      id: 's8',
      title: 'Cách dùng 1',
      subtitle: 'Hành động đang xảy ra ngay lúc nói.',
      layout: 'explain',
      accent: 'orange',
      formula: 'now / right now / at the moment',
      bullets: [
        { content: 'Dùng khi hành động đang diễn ra tại thời điểm nói.' },
        { content: 'Thường đi với now, right now, at the moment.' },
        { content: 'Chủ đề Unit 10 hay dùng với save, use, install, learn.' },
      ],
      examples: [
        'I am turning off the fan now.',
        'Students are learning about renewable energy right now.',
        'The workers are installing solar panels now.',
      ],
    },
    {
      id: 's9',
      title: 'Cách dùng 2',
      subtitle: 'Sự việc đang diễn ra trong giai đoạn hiện tại.',
      layout: 'explain',
      accent: 'blue',
      formula: 'these days / at present / currently',
      bullets: [
        { content: 'Không nhất thiết xảy ra đúng lúc nói.' },
        { content: 'Dùng để nói một xu hướng hoặc sự thay đổi hiện nay.' },
        { content: 'Hay đi với become, increase, decrease, improve, change.' },
      ],
      examples: [
        'Many countries are using more renewable energy.',
        'Solar power is becoming more popular.',
        'People’s awareness of saving energy is improving.',
      ],
    },
    {
      id: 's10',
      title: 'Cách dùng 3',
      subtitle: 'Kế hoạch tương lai gần đã được sắp xếp.',
      layout: 'cards',
      cards: [
        {
          title: 'Kế hoạch chắc chắn',
          accent: 'green',
          content: 'Present Continuous có thể nói về lịch đã sắp xếp.',
          example: 'We are visiting a solar power station tomorrow.',
        },
        {
          title: 'Thời gian tương lai',
          accent: 'orange',
          content: 'Có thể đi với tomorrow, next Monday, this weekend.',
          example: 'Our class is having a lesson about energy next Monday.',
        },
        {
          title: 'Dự án',
          accent: 'blue',
          content: 'Dùng để nói hoạt động đã có kế hoạch.',
          example: 'They are joining an energy-saving project this weekend.',
        },
      ],
    },
    {
      id: 's11',
      title: 'Dấu hiệu nhận biết',
      subtitle: 'Các trạng từ và cụm thời gian thường gặp.',
      layout: 'cards',
      cards: [
        {
          title: 'Ngay lúc nói',
          accent: 'orange',
          bullets: ['now', 'right now', 'at the moment'],
        },
        {
          title: 'Giai đoạn hiện tại',
          accent: 'blue',
          bullets: ['at present', 'currently', 'these days'],
        },
        {
          title: 'Khoảng thời gian gần',
          accent: 'green',
          bullets: ['today', 'this week', 'this month'],
        },
        {
          title: 'Ví dụ',
          accent: 'pink',
          bullets: [
            'We are studying energy sources now.',
            'People are talking about renewable energy these days.',
          ],
        },
      ],
    },
    {
      id: 's12',
      title: 'Quy tắc thêm -ing',
      subtitle: 'Chú ý khi chuyển động từ sang V-ing.',
      layout: 'cards',
      cards: [
        {
          title: 'Thêm -ing',
          accent: 'orange',
          content: 'Động từ thường thêm -ing.',
          example: 'study → studying',
        },
        {
          title: 'Bỏ -e',
          accent: 'pink',
          content: 'Tận cùng bằng -e câm: bỏ e + ing.',
          example: 'save → saving',
        },
        {
          title: 'Gấp đôi phụ âm',
          accent: 'blue',
          content: 'Một nguyên âm + một phụ âm: gấp đôi phụ âm + ing.',
          example: 'run → running',
        },
        {
          title: 'Đổi -ie',
          accent: 'green',
          content: 'Tận cùng bằng -ie: đổi ie thành y + ing.',
          example: 'lie → lying',
        },
      ],
    },
    {
      id: 's13',
      title: 'Động từ Unit 10',
      subtitle: 'Các động từ thường dùng với chủ đề Energy Sources.',
      layout: 'cards',
      cards: [
        {
          title: 'Use & save',
          accent: 'green',
          bullets: ['use → using', 'save → saving', 'waste → wasting'],
        },
        {
          title: 'Reduce & produce',
          accent: 'orange',
          bullets: ['reduce → reducing', 'produce → producing', 'generate → generating'],
        },
        {
          title: 'Develop & build',
          accent: 'blue',
          bullets: ['develop → developing', 'build → building', 'install → installing'],
        },
        {
          title: 'Protect',
          accent: 'pink',
          bullets: ['protect → protecting', 'pollute → polluting', 'recycle → recycling'],
        },
      ],
    },
    {
      id: 's14',
      title: 'Động từ trạng thái',
      subtitle: 'Một số động từ thường không dùng ở thì tiếp diễn.',
      layout: 'cards',
      cards: [
        {
          title: 'Cảm xúc',
          accent: 'pink',
          content: 'like, love, hate, prefer',
          example: 'I like solar energy.',
        },
        {
          title: 'Suy nghĩ',
          accent: 'blue',
          content: 'know, believe, understand',
          example: 'We know that coal pollutes the air.',
        },
        {
          title: 'Sở hữu',
          accent: 'orange',
          content: 'have, own, belong',
          example: 'This school has solar panels.',
        },
        {
          title: 'Giác quan',
          accent: 'green',
          content: 'see, hear, smell',
          example: 'I see a wind turbine.',
        },
      ],
    },
    {
      id: 's15',
      title: 'Present Simple vs Present Continuous',
      subtitle: 'Phân biệt thói quen và việc đang diễn ra.',
      layout: 'cards',
      cards: [
        {
          title: 'Present Simple',
          accent: 'orange',
          content: 'Thói quen, sự thật, lịch trình.',
          example: 'People use electricity every day.',
        },
        {
          title: 'Present Continuous',
          accent: 'blue',
          content: 'Đang xảy ra hoặc xu hướng hiện tại.',
          example: 'People are using more solar energy these days.',
        },
        {
          title: 'Dấu hiệu',
          accent: 'green',
          content: 'Simple: usually, every day. Continuous: now, these days.',
          example: 'We are saving energy now.',
        },
      ],
    },
    {
      id: 's16',
      title: 'Lỗi thường gặp',
      subtitle: 'Những lỗi cần tránh với Present Continuous.',
      layout: 'cards',
      cards: [
        {
          title: 'Thiếu be',
          accent: 'orange',
          content: 'Không được bỏ am / is / are.',
          example: 'People are using renewable energy.',
        },
        {
          title: 'Thiếu V-ing',
          accent: 'pink',
          content: 'Sau am / is / are phải dùng V-ing.',
          example: 'We are saving energy.',
        },
        {
          title: 'Sai be',
          accent: 'blue',
          content: 'Chọn đúng am / is / are theo chủ ngữ.',
          example: 'They are reducing pollution.',
        },
        {
          title: 'Câu hỏi',
          accent: 'green',
          content: 'Đảo am / is / are lên trước chủ ngữ.',
          example: 'Are you saving energy?',
        },
      ],
    },
    {
      id: 's17',
      title: 'Ví dụ minh họa',
      subtitle: 'Nhìn câu và nhận diện cấu trúc.',
      layout: 'cards',
      cards: [
        {
          title: 'Now',
          accent: 'orange',
          content: 'Now là dấu hiệu hành động đang xảy ra.',
          example: 'We are learning about renewable energy now.',
        },
        {
          title: 'These days',
          accent: 'blue',
          content: 'Diễn tả xu hướng trong giai đoạn hiện tại.',
          example: 'People are using more solar power these days.',
        },
        {
          title: 'V-ing',
          accent: 'green',
          content: 'Install thêm -ing thành installing.',
          example: 'Workers are installing solar panels.',
        },
        {
          title: 'Câu hỏi',
          accent: 'pink',
          content: 'Are + S + V-ing?',
          example: 'Are they building a new wind farm?',
        },
      ],
    },
    {
      id: 's18',
      title: 'Phần 2',
      subtitle: 'Energy Sources Vocabulary',
      layout: 'section-cover',
      accent: 'blue',
    },
    {
      id: 's19',
      title: 'Các nguồn năng lượng',
      subtitle: 'Từ vựng trọng tâm của Unit 10.',
      layout: 'cards',
      cards: [
        {
          title: 'Renewable',
          accent: 'green',
          bullets: ['solar energy', 'wind energy', 'hydro energy'],
        },
        {
          title: 'Non-renewable',
          accent: 'pink',
          bullets: ['coal', 'oil', 'gas'],
        },
        {
          title: 'General words',
          accent: 'blue',
          bullets: ['energy', 'energy source', 'electricity'],
        },
        {
          title: 'Comparison',
          accent: 'orange',
          bullets: ['renewable energy', 'non-renewable energy'],
        },
      ],
    },
    {
      id: 's20',
      title: 'Thiết bị và công trình',
      subtitle: 'Những thứ tạo ra hoặc tiết kiệm năng lượng.',
      layout: 'cards',
      cards: [
        {
          title: 'Solar',
          accent: 'orange',
          bullets: ['solar panel', 'solar power station'],
        },
        {
          title: 'Wind & water',
          accent: 'blue',
          bullets: ['wind turbine', 'hydropower plant'],
        },
        {
          title: 'Electricity',
          accent: 'green',
          bullets: ['battery', 'electric car', 'LED light'],
        },
        {
          title: 'Saving energy',
          accent: 'pink',
          bullets: ['energy-saving bulb', 'turn off the lights'],
        },
      ],
    },
    {
      id: 's21',
      title: 'Tính từ miêu tả năng lượng',
      subtitle: 'Dùng để nhận xét nguồn năng lượng.',
      layout: 'cards',
      cards: [
        {
          title: 'Positive',
          accent: 'green',
          bullets: ['renewable', 'clean', 'safe', 'useful'],
        },
        {
          title: 'Negative',
          accent: 'pink',
          bullets: ['non-renewable', 'dirty', 'dangerous'],
        },
        {
          title: 'Cost',
          accent: 'orange',
          bullets: ['cheap', 'expensive', 'becoming cheaper'],
        },
        {
          title: 'Trend',
          accent: 'blue',
          bullets: ['popular', 'becoming popular', 'improving'],
        },
      ],
    },
    {
      id: 's22',
      title: 'Cấu trúc giao tiếp',
      subtitle: 'Ba mẫu câu dùng nhiều trong Unit 10.',
      layout: 'cards',
      cards: [
        {
          title: 'Tiết kiệm năng lượng',
          accent: 'green',
          content: 'S + am/is/are + V-ing + to save energy.',
          example: 'We are turning off the lights to save energy.',
        },
        {
          title: 'Xu hướng hiện nay',
          accent: 'blue',
          content: 'S + am/is/are + becoming / using / developing + ...',
          example: 'Renewable energy is becoming more popular.',
        },
        {
          title: 'Hỏi đang làm gì',
          accent: 'orange',
          content: 'What + am/is/are + S + V-ing?',
          example: 'What are they studying?',
        },
      ],
    },
    {
      id: 's23',
      title: 'Luyện tập nhanh',
      subtitle: 'Điền dạng đúng của động từ hoặc to be.',
      layout: 'practice',
      accent: 'orange',
      bullets: [
        { content: 'People _____ using more renewable energy.' },
        { content: 'She is _____ solar power at home.' },
        { content: 'They aren’t _____ a coal power plant.' },
        { content: '_____ you saving electricity now?' },
      ],
      examples: ['are', 'using', 'building', 'Are'],
    },
    {
      id: 's24',
      title: 'Unit 10 Recap',
      subtitle: 'Energy Sources',
      layout: 'practice',
      accent: 'purple',
      bullets: [
        { content: 'Present Continuous: S + am / is / are + V-ing.' },
        { content: 'Dùng cho hành động đang xảy ra, xu hướng hiện tại hoặc kế hoạch gần.' },
        { content: 'Dấu hiệu thường gặp: now, at the moment, these days, currently.' },
        { content: 'Từ vựng năng lượng tập trung vào renewable, non-renewable, saving energy.' },
      ],
      examples: [
        'We are saving electricity at home.',
        'Solar power is becoming more popular.',
        'What are you doing to save energy?',
      ],
    },
  ],
};

export default deck;
