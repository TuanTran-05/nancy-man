import { LessonDeck } from '../../../types';

const deck: LessonDeck = {
  id: 'gs-g7-u12-english-speaking-countries',
  curriculumFamily: 'global-success',
  grade: 7,
  unitNumber: 12,
  title: 'Grammar Grade 7 - Unit 12: English-Speaking Countries',
  description:
    'Bài giảng Unit 12 Global Success 7 về Articles: a, an, the, zero article và từ vựng chủ đề English-speaking Countries.',
  createdAt: '2026-05-18T00:00:00.000Z',
  slides: [
    {
      id: 's1',
      title: 'GRAMMAR GRADE 7',
      subtitle: 'UNIT 12: ENGLISH-SPEAKING COUNTRIES',
      label: 'NỘI DUNG BÀI HỌC:',
      layout: 'outline',
      cards: [
        {
          title: 'ARTICLES: A / AN / THE',
          subtitle: '(Mạo từ trong tiếng Anh)',
          accent: 'orange',
        },
        {
          title: 'ZERO ARTICLE',
          subtitle: '(Khi không dùng mạo từ)',
          accent: 'pink',
        },
        {
          title: 'ENGLISH-SPEAKING COUNTRIES',
          subtitle: '(Từ vựng quốc gia nói tiếng Anh)',
          accent: 'blue',
        },
      ],
    },
    {
      id: 's2',
      title: 'Mục tiêu bài học',
      layout: 'objectives',
      bullets: [
        { content: 'Phân biệt cách dùng a, an, the và zero article.' },
        { content: 'Chọn a / an theo âm đầu của danh từ, không chỉ theo chữ cái.' },
        {
          content:
            'Dùng the đúng với quốc gia đặc biệt, sông, biển, đại dương và địa danh nổi tiếng.',
        },
        { content: 'Nói về quốc gia, thủ đô, địa danh và ngôn ngữ bằng mẫu câu đơn giản.' },
      ],
    },
    {
      id: 's3',
      title: 'Phần 1',
      subtitle: 'Articles: A / An / The',
      layout: 'section-cover',
      accent: 'orange',
    },
    {
      id: 's4',
      title: 'Articles là gì?',
      subtitle: 'Mạo từ đứng trước danh từ để cho biết danh từ đã xác định hay chưa.',
      layout: 'cards',
      cards: [
        {
          title: 'A',
          accent: 'orange',
          content: 'Danh từ số ít chưa xác định, bắt đầu bằng âm phụ âm.',
          example: 'a country',
        },
        {
          title: 'An',
          accent: 'green',
          content: 'Danh từ số ít chưa xác định, bắt đầu bằng âm nguyên âm.',
          example: 'an island',
        },
        {
          title: 'The',
          accent: 'pink',
          content: 'Danh từ đã xác định, duy nhất hoặc địa danh đặc biệt.',
          example: 'the USA',
        },
        {
          title: 'Zero article',
          accent: 'blue',
          content: 'Không dùng mạo từ trước nhiều tên riêng, quốc gia thường và ngôn ngữ.',
          example: 'Canada, English',
        },
      ],
    },
    {
      id: 's5',
      title: 'Mạo từ A',
      subtitle: 'Dùng trước danh từ số ít đếm được bắt đầu bằng âm phụ âm.',
      layout: 'explain',
      accent: 'orange',
      formula: 'a + singular countable noun',
      bullets: [
        { content: 'Dùng khi nhắc đến một người, vật hoặc nơi chưa xác định.' },
        { content: 'Danh từ phía sau phải là danh từ số ít đếm được.' },
        { content: 'Chọn a theo âm đầu khi đọc.' },
      ],
      examples: [
        'Australia is a large country.',
        'Sydney is a famous city in Australia.',
        'English is a popular language.',
      ],
    },
    {
      id: 's6',
      title: 'Mạo từ An',
      subtitle: 'Dùng trước danh từ số ít đếm được bắt đầu bằng âm nguyên âm.',
      layout: 'explain',
      accent: 'green',
      formula: 'an + singular countable noun',
      bullets: [
        { content: 'Các âm nguyên âm thường bắt đầu bằng /a/, /e/, /i/, /o/, /u/.' },
        { content: 'Không chỉ nhìn chữ cái đầu, cần nghe âm đầu khi đọc.' },
        { content: 'Dùng với các cụm như an island, an English-speaking country.' },
      ],
      examples: [
        'The UK is an English-speaking country.',
        'Ireland is an island country.',
        'English is an international language.',
      ],
    },
    {
      id: 's7',
      title: 'A hay An?',
      subtitle: 'Quy tắc dựa vào âm đầu tiên khi đọc.',
      layout: 'cards',
      cards: [
        {
          title: 'Dùng A',
          accent: 'orange',
          bullets: ['a country', 'a city', 'a university', 'a European country'],
        },
        {
          title: 'Dùng An',
          accent: 'green',
          bullets: ['an island', 'an old city', 'an hour', 'an honest person'],
        },
        {
          title: 'Ghi nhớ',
          accent: 'blue',
          content: 'university và European bắt đầu bằng âm /juː/ hoặc /j/, nên dùng a.',
          example: 'a university, a European country',
        },
        {
          title: 'H câm',
          accent: 'pink',
          content: 'hour và honest có h câm, nên dùng an.',
          example: 'an hour, an honest person',
        },
      ],
    },
    {
      id: 's8',
      title: 'Phần 2',
      subtitle: 'The và Zero Article',
      layout: 'section-cover',
      accent: 'pink',
    },
    {
      id: 's9',
      title: 'Khi nào dùng The?',
      subtitle: 'The dùng khi danh từ đã xác định rõ.',
      layout: 'cards',
      cards: [
        {
          title: 'Nhắc lại lần hai',
          accent: 'orange',
          content: 'Lần đầu dùng a/an, lần sau dùng the.',
          example: 'I visited a museum. The museum was old.',
        },
        {
          title: 'Danh từ duy nhất',
          accent: 'pink',
          content: 'Dùng the với những thứ được xem là duy nhất.',
          example: 'the sun, the moon, the world',
        },
        {
          title: 'Đã xác định',
          accent: 'blue',
          content: 'Người nói và người nghe đều biết đang nói đến đối tượng nào.',
          example: 'the capital city',
        },
      ],
    },
    {
      id: 's10',
      title: 'The với quốc gia đặc biệt',
      subtitle: 'Tên quốc gia thông thường thường không dùng the, nhưng có ngoại lệ.',
      layout: 'cards',
      cards: [
        {
          title: 'Có The',
          accent: 'pink',
          bullets: ['the United Kingdom', 'the USA', 'the Philippines', 'the Netherlands'],
        },
        {
          title: 'Không The',
          accent: 'green',
          bullets: ['Canada', 'Australia', 'New Zealand', 'Ireland'],
        },
        {
          title: 'Quy tắc nhớ',
          accent: 'orange',
          content: 'Dùng the với tên có Kingdom, States, Republic hoặc dạng số nhiều.',
          example: 'the United States',
        },
        {
          title: 'Ví dụ',
          accent: 'blue',
          content: 'The USA is a large English-speaking country.',
          example: 'Canada is an English-speaking country.',
        },
      ],
    },
    {
      id: 's11',
      title: 'The với địa danh',
      subtitle: 'Một số nhóm địa danh thường đi với the.',
      layout: 'cards',
      cards: [
        {
          title: 'Sông',
          accent: 'blue',
          bullets: ['the Thames', 'the Nile'],
        },
        {
          title: 'Biển / đại dương',
          accent: 'orange',
          bullets: ['the North Sea', 'the Pacific Ocean', 'the Atlantic Ocean'],
        },
        {
          title: 'Dãy núi / sa mạc',
          accent: 'green',
          bullets: ['the Rocky Mountains', 'the Alps', 'the Sahara Desert'],
        },
        {
          title: 'Công trình nổi tiếng',
          accent: 'pink',
          bullets: ['the Statue of Liberty', 'the Sydney Opera House', 'the London Eye'],
        },
      ],
    },
    {
      id: 's12',
      title: 'Không dùng mạo từ',
      subtitle: 'Zero article với tên riêng, quốc gia thường và ngôn ngữ.',
      layout: 'cards',
      cards: [
        {
          title: 'Quốc gia thường',
          accent: 'green',
          bullets: ['Canada', 'Australia', 'New Zealand'],
        },
        {
          title: 'Thành phố',
          accent: 'blue',
          bullets: ['London', 'Sydney', 'Ottawa'],
        },
        {
          title: 'Ngôn ngữ',
          accent: 'orange',
          bullets: ['English', 'French', 'Vietnamese'],
        },
        {
          title: 'Tên người',
          accent: 'pink',
          bullets: ['Mary', 'Tom', 'David'],
        },
      ],
    },
    {
      id: 's13',
      title: 'Lỗi thường gặp',
      subtitle: 'Những lỗi cần tránh khi dùng mạo từ.',
      layout: 'cards',
      cards: [
        {
          title: 'A / An + số ít',
          accent: 'orange',
          content: 'Không dùng a/an với danh từ số nhiều.',
          example: 'Canada is an English-speaking country.',
        },
        {
          title: 'Không dùng the sai chỗ',
          accent: 'green',
          content: 'Tên quốc gia thông thường không dùng the.',
          example: 'Canada is beautiful.',
        },
        {
          title: 'Ngôn ngữ',
          accent: 'blue',
          content: 'Không dùng the trước tên ngôn ngữ.',
          example: 'People speak English in Canada.',
        },
        {
          title: 'Lần đầu / lần sau',
          accent: 'pink',
          content: 'Lần đầu dùng a/an, nhắc lại dùng the.',
          example: 'I saw a castle. The castle was old.',
        },
      ],
    },
    {
      id: 's14',
      title: 'Ví dụ minh họa',
      subtitle: 'Nhìn mạo từ và giải thích nhanh.',
      layout: 'cards',
      cards: [
        {
          title: 'An',
          accent: 'green',
          content: 'English-speaking bắt đầu bằng âm nguyên âm /e/.',
          example: 'Canada is an English-speaking country.',
        },
        {
          title: 'A',
          accent: 'orange',
          content: 'famous bắt đầu bằng âm phụ âm /f/.',
          example: 'Sydney is a famous city.',
        },
        {
          title: 'The',
          accent: 'pink',
          content: 'USA là tên quốc gia đặc biệt.',
          example: 'The USA is a large country.',
        },
        {
          title: 'Zero article',
          accent: 'blue',
          content: 'English là tên ngôn ngữ.',
          example: 'English is an international language.',
        },
      ],
    },
    {
      id: 's15',
      title: 'Phần 3',
      subtitle: 'English-Speaking Countries',
      layout: 'section-cover',
      accent: 'blue',
    },
    {
      id: 's16',
      title: 'Quốc gia và thủ đô',
      subtitle: 'Từ vựng trọng tâm của Unit 12.',
      layout: 'cards',
      cards: [
        {
          title: 'Countries',
          accent: 'blue',
          bullets: ['the UK', 'the USA', 'Canada', 'Australia', 'New Zealand'],
        },
        {
          title: 'Capitals',
          accent: 'orange',
          bullets: ['London', 'Washington, D.C.', 'Ottawa', 'Canberra', 'Wellington'],
        },
        {
          title: 'Culture words',
          accent: 'green',
          bullets: ['language', 'culture', 'accent', 'nationality'],
        },
        {
          title: 'Adjectives',
          accent: 'pink',
          bullets: ['famous', 'multicultural', 'peaceful', 'international'],
        },
      ],
    },
    {
      id: 's17',
      title: 'Địa danh nổi tiếng',
      subtitle: 'Nhớ mạo từ the với nhiều tên công trình nổi tiếng.',
      layout: 'cards',
      cards: [
        {
          title: 'The USA',
          accent: 'pink',
          bullets: ['the Statue of Liberty', 'the White House'],
        },
        {
          title: 'The UK',
          accent: 'blue',
          bullets: ['the London Eye', 'the Tower of London'],
        },
        {
          title: 'Australia',
          accent: 'orange',
          bullets: ['the Sydney Opera House'],
        },
        {
          title: 'Canada',
          accent: 'green',
          bullets: ['Niagara Falls', 'the Thames River is in London'],
        },
      ],
    },
    {
      id: 's18',
      title: 'Cấu trúc giao tiếp',
      subtitle: 'Các mẫu câu thường dùng trong Unit 12.',
      layout: 'cards',
      cards: [
        {
          title: 'Quốc gia nói tiếng Anh',
          accent: 'green',
          content: 'S + be + an English-speaking country.',
          example: 'Canada is an English-speaking country.',
        },
        {
          title: 'Nói thủ đô',
          accent: 'orange',
          content: 'City + is the capital of + country.',
          example: 'Ottawa is the capital of Canada.',
        },
        {
          title: 'Nói địa danh',
          accent: 'pink',
          content: 'Landmark + be + in + place.',
          example: 'The Statue of Liberty is in New York.',
        },
        {
          title: 'Nói ngôn ngữ',
          accent: 'blue',
          content: 'People + speak + language + in + country.',
          example: 'People speak English in Australia.',
        },
      ],
    },
    {
      id: 's19',
      title: 'Luyện tập nhanh',
      subtitle: 'Điền a, an, the hoặc không dùng mạo từ.',
      layout: 'practice',
      accent: 'orange',
      bullets: [
        { content: 'Canada is _____ English-speaking country.' },
        { content: 'Sydney is _____ famous city in Australia.' },
        { content: '_____ USA is a large country.' },
        { content: 'People speak _____ English in Canada.' },
      ],
      examples: ['an', 'a', 'The', 'no article'],
    },
    {
      id: 's20',
      title: 'Unit 12 Recap',
      subtitle: 'English-Speaking Countries',
      layout: 'practice',
      accent: 'purple',
      bullets: [
        { content: 'A dùng trước danh từ số ít bắt đầu bằng âm phụ âm.' },
        { content: 'An dùng trước danh từ số ít bắt đầu bằng âm nguyên âm.' },
        { content: 'The dùng với danh từ đã xác định, duy nhất hoặc địa danh đặc biệt.' },
        { content: 'Không dùng mạo từ trước nhiều tên quốc gia thường, thành phố và ngôn ngữ.' },
      ],
      examples: [
        'a famous city',
        'an English-speaking country',
        'the United Kingdom',
        'People speak English.',
      ],
    },
  ],
};

export default deck;
