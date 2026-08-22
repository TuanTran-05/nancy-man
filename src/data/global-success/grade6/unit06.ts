import { LessonDeck } from '../../../types';

const deck: LessonDeck = {
  id: 'gs-g6-u6-our-tet-holiday',
  curriculumFamily: 'global-success',
  grade: 6,
  unitNumber: 6,
  title: 'Grammar Grade 6 - Unit 6: Our Tet Holiday',
  description:
    'Bài giảng Unit 6 Global Success 6 về should / should not, some / any và từ vựng Our Tet Holiday.',
  createdAt: '2026-05-17T00:00:00.000Z',
  slides: [
    {
      id: 's1',
      title: 'GRAMMAR GRADE 6',
      subtitle: 'UNIT 6: OUR TET HOLIDAY',
      label: 'NỘI DUNG BÀI HỌC:',
      layout: 'outline',
      cards: [
        {
          title: 'SHOULD / SHOULD NOT',
          subtitle: '(Nên / Không nên)',
          accent: 'orange',
        },
        {
          title: 'SOME / ANY',
          subtitle: '(Một vài / Một ít / Bất kỳ)',
          accent: 'pink',
        },
        {
          title: 'TET VOCABULARY',
          subtitle: '(Hoạt động và đồ vật ngày Tết)',
          accent: 'blue',
        },
        {
          title: 'PRACTICE',
          subtitle: '(Luyện dùng trong ngữ cảnh Tết)',
          accent: 'green',
        },
      ],
    },
    {
      id: 's2',
      title: 'Mục tiêu bài học',
      layout: 'objectives',
      accent: 'blue',
      bullets: [
        {
          content: [
            { text: 'Dùng ' },
            { text: 'should / should not', accent: 'orange', bold: true },
            { text: ' để đưa ra lời khuyên trong dịp Tết.' },
          ],
        },
        {
          content: [
            { text: 'Phân biệt ' },
            { text: 'some', accent: 'pink', bold: true },
            { text: ' và ' },
            { text: 'any', accent: 'green', bold: true },
            { text: ' trong câu khẳng định, phủ định và nghi vấn.' },
          ],
        },
        {
          content: 'Nhận biết từ vựng về hoạt động, món ăn và đồ vật thường gặp trong ngày Tết.',
        },
        {
          content: 'Kết hợp hai cấu trúc để nói về việc nên làm và những thứ cần chuẩn bị cho Tết.',
        },
      ],
    },
    {
      id: 's3',
      title: 'SHOULD / SHOULD NOT',
      subtitle: 'Nên / Không nên',
      label: 'Phần 1',
      layout: 'section-cover',
      accent: 'orange',
    },
    {
      id: 's4',
      title: 'Should: công thức cơ bản',
      subtitle: 'Sau should luôn dùng động từ nguyên mẫu.',
      layout: 'explain',
      accent: 'orange',
      sections: [
        {
          title: 'Khẳng định',
          accent: 'green',
          content: [
            { text: 'S + ' },
            { text: 'should + V nguyên mẫu', accent: 'green', bold: true },
          ],
          example: 'You should help your parents.',
        },
        {
          title: 'Phủ định',
          accent: 'red',
          content: [
            { text: 'S + ' },
            { text: 'should not + V nguyên mẫu', accent: 'red', bold: true },
          ],
          example: 'You should not eat too much candy.',
        },
        {
          title: 'Nghi vấn',
          accent: 'blue',
          content: [
            { text: 'Should + S + ' },
            { text: 'V nguyên mẫu', accent: 'blue', bold: true },
            { text: '?' },
          ],
          example: 'Should we buy flowers?',
        },
      ],
      examples: ['Yes, we should.', 'No, we should not.'],
    },
    {
      id: 's5',
      title: 'Should trong dịp Tết',
      subtitle: 'Dùng để nói việc nên làm hoặc chuẩn bị trước Tết.',
      layout: 'cards',
      cards: [
        {
          title: 'Lời khuyên',
          accent: 'orange',
          bullets: ['visit grandparents', 'say good wishes', 'keep the house clean'],
        },
        {
          title: 'Phong tục nên làm',
          accent: 'green',
          bullets: ['decorate the house', 'visit relatives', 'wear nice clothes'],
        },
        {
          title: 'Chuẩn bị trước Tết',
          accent: 'blue',
          bullets: ['buy flowers', 'prepare lucky money', 'go shopping'],
        },
      ],
    },
    {
      id: 's6',
      title: 'Should not và điều kiêng kỵ',
      subtitle: 'Dùng để khuyên không nên làm điều gì đó.',
      layout: 'cards',
      cards: [
        {
          title: 'Không nên làm',
          accent: 'red',
          bullets: ['eat too much candy', 'make noise at night', 'play with firecrackers'],
        },
        {
          title: 'Trong ngày Tết',
          accent: 'pink',
          bullets: ['break things', 'sweep the floor on the first day', 'say bad words'],
        },
        {
          title: 'So sánh với must',
          accent: 'blue',
          bullets: [
            'should = lời khuyên',
            'must = bắt buộc',
            'should not = không nên',
            'must not = không được',
          ],
        },
      ],
    },
    {
      id: 's7',
      title: 'Lỗi thường gặp với should',
      subtitle: 'Kiểm tra động từ đứng ngay sau should.',
      layout: 'cards',
      cards: [
        {
          title: 'Không thêm to',
          accent: 'red',
          bullets: ['Sai: should to visit', 'Đúng: should visit'],
        },
        {
          title: 'Không chia theo chủ ngữ',
          accent: 'orange',
          bullets: ['Sai: she shoulds clean', 'Đúng: she should clean'],
        },
        {
          title: 'Động từ nguyên mẫu',
          accent: 'blue',
          bullets: ['Sai: should eats', 'Đúng: should eat'],
        },
      ],
    },
    {
      id: 's8',
      title: 'SOME / ANY',
      subtitle: 'Một vài / Một ít / Bất kỳ',
      label: 'Phần 2',
      layout: 'section-cover',
      accent: 'pink',
    },
    {
      id: 's9',
      title: 'Some: dùng khi nào?',
      subtitle: 'Some thường đi với câu khẳng định và lời mời.',
      layout: 'explain',
      accent: 'pink',
      sections: [
        {
          title: 'Câu khẳng định',
          accent: 'green',
          content: [
            { text: 'some + ' },
            { text: 'danh từ số nhiều / không đếm được', accent: 'green', bold: true },
          ],
          example: 'We buy some flowers before Tet.',
        },
        {
          title: 'Lời mời',
          accent: 'pink',
          content: 'Dùng some trong câu hỏi khi đó là lời mời hoặc đề nghị.',
          example: 'Would you like some tea?',
        },
        {
          title: 'Ví dụ thường gặp',
          accent: 'blue',
          bullets: ['some sweets', 'some food', 'some lucky money'],
        },
      ],
    },
    {
      id: 's10',
      title: 'Any: dùng khi nào?',
      subtitle: 'Any thường dùng trong câu phủ định và câu hỏi.',
      layout: 'explain',
      accent: 'blue',
      sections: [
        {
          title: 'Câu phủ định',
          accent: 'red',
          content: [
            { text: 'do/does not + V + ' },
            { text: 'any + noun', accent: 'red', bold: true },
          ],
          example: 'We do not have any flowers.',
        },
        {
          title: 'There is / There are',
          accent: 'orange',
          content: 'There is not / There are not + any + noun',
          example: 'There are not any sweets on the table.',
        },
        {
          title: 'Câu hỏi',
          accent: 'blue',
          content: 'Do/Does + S + V + any + noun?',
          example: 'Do you have any plans for Tet?',
        },
      ],
    },
    {
      id: 's11',
      title: 'Some vs Any',
      subtitle: 'Chọn theo loại câu, không theo loại danh từ.',
      layout: 'cards',
      cards: [
        {
          title: 'SOME',
          accent: 'pink',
          bullets: ['Câu khẳng định', 'Lời mời / đề nghị'],
          example: 'We have some flowers.',
        },
        {
          title: 'ANY',
          accent: 'blue',
          bullets: ['Câu phủ định', 'Câu hỏi thông thường'],
          example: 'Do you have any sweets?',
        },
        {
          title: 'Đếm được / không đếm được',
          accent: 'green',
          bullets: ['some flowers', 'some food', 'any gifts', 'any water'],
        },
        {
          title: 'Lỗi cần tránh',
          accent: 'red',
          bullets: ['Sai: We have any sweets.', 'Đúng: We have some sweets.'],
        },
      ],
    },
    {
      id: 's12',
      title: 'OUR TET HOLIDAY',
      subtitle: 'Từ vựng chủ đề ngày Tết',
      label: 'Phần 3',
      layout: 'section-cover',
      accent: 'green',
    },
    {
      id: 's13',
      title: 'Tet Vocabulary',
      subtitle: 'Các nhóm từ vựng xuất hiện nhiều trong Unit 6.',
      layout: 'cards',
      cards: [
        {
          title: 'Activities',
          accent: 'orange',
          bullets: ['clean the house', 'decorate the house', 'visit relatives', 'go shopping'],
        },
        {
          title: 'Tet items',
          accent: 'pink',
          bullets: ['lucky money', 'red envelope', 'peach blossom', 'decorations'],
        },
        {
          title: 'Food & events',
          accent: 'blue',
          bullets: ['banh chung', 'sweets', 'fruit', 'fireworks'],
        },
        {
          title: 'Adjectives',
          accent: 'green',
          bullets: ['happy', 'special', 'traditional', 'exciting'],
        },
      ],
    },
    {
      id: 's14',
      title: 'Kết hợp cấu trúc',
      subtitle: 'Nói về việc nên làm và đồ cần chuẩn bị cho Tết.',
      layout: 'explain',
      accent: 'purple',
      sections: [
        {
          title: 'Mẫu 1',
          accent: 'orange',
          content: 'We should buy some peach blossoms before Tet.',
        },
        {
          title: 'Mẫu 2',
          accent: 'pink',
          content: 'Children should not play with any firecrackers.',
        },
        {
          title: 'Mẫu 3',
          accent: 'blue',
          content: 'Do we need any decorations for the living room?',
        },
      ],
      footerNote: 'Khi nói về Tết, should nói việc nên làm; some/any nói số lượng đồ cần chuẩn bị.',
    },
    {
      id: 's15',
      title: 'Luyện tập nhanh',
      subtitle: 'Hoàn thành câu với should, should not, some hoặc any.',
      layout: 'practice',
      accent: 'green',
      bullets: [
        { content: 'You _____ visit your grandparents at Tet.' },
        { content: 'We do not have _____ flowers in the living room.' },
        { content: 'Would you like _____ tea?' },
        { content: 'Children _____ eat too much candy.' },
      ],
      examples: ['should', 'any', 'some', 'should not'],
    },
    {
      id: 's16',
      title: 'Unit 6 Recap',
      subtitle: 'Our Tet Holiday',
      layout: 'practice',
      accent: 'purple',
      bullets: [
        { content: 'Should + V dùng để đưa ra lời khuyên.' },
        { content: 'Should not + V dùng để nói điều không nên làm.' },
        { content: 'Some thường đi với câu khẳng định và lời mời.' },
        { content: 'Any thường đi với câu phủ định và câu hỏi.' },
      ],
      examples: [
        'We should clean the house.',
        'Do you have any sweets?',
        'Would you like some tea?',
      ],
    },
  ],
};

export default deck;
