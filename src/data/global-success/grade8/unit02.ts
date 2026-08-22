import { LessonDeck } from '../../../types';

const deck: LessonDeck = {
  id: 'gs-g8-u2-life-in-the-countryside',
  curriculumFamily: 'global-success',
  grade: 8,
  unitNumber: 2,
  title: 'Grammar Grade 8 - Unit 2: Life in the Countryside',
  description:
    'Bài giảng Unit 2 Global Success 8 về Comparative Forms of Adverbs và từ vựng chủ đề Life in the Countryside.',
  createdAt: '2026-05-18T00:00:00.000Z',
  slides: [
    {
      id: 's1',
      title: 'GRAMMAR GRADE 8',
      subtitle: 'UNIT 2: LIFE IN THE COUNTRYSIDE',
      label: 'NỘI DUNG BÀI HỌC:',
      layout: 'outline',
      cards: [
        {
          title: 'COMPARATIVE FORMS OF ADVERBS',
          subtitle: '(So sánh hơn của trạng từ)',
          accent: 'orange',
        },
        {
          title: 'ADJECTIVE VS ADVERB',
          subtitle: '(Phân biệt tính từ và trạng từ)',
          accent: 'pink',
        },
        {
          title: 'COUNTRYSIDE VOCABULARY',
          subtitle: '(Từ vựng cuộc sống nông thôn)',
          accent: 'blue',
        },
      ],
    },
    {
      id: 's2',
      title: 'Mục tiêu bài học',
      layout: 'objectives',
      bullets: [
        { content: 'Hiểu trạng từ bổ nghĩa cho hành động và khác với tính từ.' },
        {
          content: 'Dùng đúng so sánh hơn của trạng từ ngắn, trạng từ dài và trạng từ bất quy tắc.',
        },
        { content: 'So sánh cách sống, làm việc, di chuyển ở nông thôn và thành phố.' },
        { content: 'Tránh lỗi dùng more với trạng từ ngắn hoặc thêm -er cho trạng từ dài.' },
      ],
    },
    {
      id: 's3',
      title: 'Phần 1',
      subtitle: 'Comparative Forms of Adverbs',
      layout: 'section-cover',
      accent: 'orange',
    },
    {
      id: 's4',
      title: 'So sánh hơn của trạng từ',
      subtitle: 'Dùng để so sánh cách một hành động được thực hiện.',
      layout: 'explain',
      accent: 'orange',
      formula: 'S + V + comparative adverb + than + N / pronoun',
      bullets: [
        { content: 'Trạng từ bổ nghĩa cho động từ, trả lời câu hỏi hành động xảy ra như thế nào.' },
        {
          content:
            'So sánh hơn của trạng từ dùng để so sánh cách làm giữa hai người, nơi hoặc sự việc.',
        },
        { content: 'Trong Unit 2, cấu trúc này thường so sánh nông thôn và thành phố.' },
      ],
      examples: [
        'Farmers work harder than office workers.',
        'People in the countryside live more peacefully than people in the city.',
        'Children in the countryside play more freely than children in the city.',
      ],
    },
    {
      id: 's5',
      title: 'Trạng từ là gì?',
      subtitle: 'Adverbs cho biết hành động được làm như thế nào.',
      layout: 'cards',
      cards: [
        {
          title: 'Quickly',
          accent: 'orange',
          content: 'Bổ nghĩa cho run.',
          example: 'He runs quickly.',
        },
        {
          title: 'Softly',
          accent: 'pink',
          content: 'Bổ nghĩa cho speak.',
          example: 'She speaks softly.',
        },
        {
          title: 'Hard',
          accent: 'blue',
          content: 'Bổ nghĩa cho work.',
          example: 'Farmers work hard.',
        },
        {
          title: 'Peacefully',
          accent: 'green',
          content: 'Bổ nghĩa cho live.',
          example: 'People live peacefully.',
        },
      ],
    },
    {
      id: 's6',
      title: 'Công thức chung',
      subtitle: 'Có hai nhóm chính: trạng từ ngắn và trạng từ dài.',
      layout: 'cards',
      cards: [
        {
          title: 'Trạng từ ngắn',
          accent: 'orange',
          content: 'S + V + short adverb-er + than + N',
          example: 'Farmers work harder than students.',
        },
        {
          title: 'Trạng từ dài',
          accent: 'blue',
          content: 'S + V + more + long adverb + than + N',
          example: 'She speaks more politely than her brother.',
        },
        {
          title: 'Bất quy tắc',
          accent: 'pink',
          content: 'Dùng dạng đặc biệt.',
          example: 'She sings better than her sister.',
        },
      ],
    },
    {
      id: 's7',
      title: 'Trạng từ ngắn',
      subtitle: 'Một số trạng từ ngắn thêm -er để tạo so sánh hơn.',
      layout: 'cards',
      cards: [
        {
          title: 'Fast',
          accent: 'orange',
          content: 'fast → faster',
          example: 'He runs faster than his friend.',
        },
        {
          title: 'Hard',
          accent: 'blue',
          content: 'hard → harder',
          example: 'Farmers work harder than many people think.',
        },
        {
          title: 'Early',
          accent: 'green',
          content: 'early → earlier',
          example: 'My grandparents get up earlier than my parents.',
        },
        {
          title: 'Late / Near',
          accent: 'pink',
          content: 'late → later; near → nearer',
          example: 'The market opens earlier than the supermarket.',
        },
      ],
    },
    {
      id: 's8',
      title: 'Trạng từ dài',
      subtitle: 'Phần lớn trạng từ dài, đặc biệt có đuôi -ly, dùng more.',
      layout: 'explain',
      accent: 'blue',
      formula: 'more + adverb + than',
      bullets: [
        { content: 'Không thêm -er vào trạng từ dài.' },
        { content: 'Các trạng từ kết thúc bằng -ly thường dùng more.' },
        { content: 'Dạng này rất hay gặp khi nói về đời sống nông thôn.' },
      ],
      examples: [
        'People in the countryside live more peacefully than people in big cities.',
        'My grandmother speaks more slowly than my teacher.',
        'Villagers drive more carefully than tourists on small roads.',
      ],
    },
    {
      id: 's9',
      title: 'Các trạng từ dài thường gặp',
      subtitle: 'Ghi nhớ dạng more + adverb.',
      layout: 'cards',
      cards: [
        {
          title: 'Peaceful life',
          accent: 'green',
          bullets: ['peacefully → more peacefully', 'quietly → more quietly'],
        },
        {
          title: 'Careful actions',
          accent: 'blue',
          bullets: ['carefully → more carefully', 'safely → more safely'],
        },
        {
          title: 'Clear / easy',
          accent: 'orange',
          bullets: ['clearly → more clearly', 'easily → more easily'],
        },
        {
          title: 'Happy / free',
          accent: 'pink',
          bullets: ['happily → more happily', 'freely → more freely'],
        },
      ],
    },
    {
      id: 's10',
      title: 'Trạng từ bất quy tắc',
      subtitle: 'Một số trạng từ có dạng so sánh đặc biệt.',
      layout: 'cards',
      cards: [
        {
          title: 'Well',
          accent: 'green',
          content: 'well → better',
          example: 'She sings better than her sister.',
        },
        {
          title: 'Badly',
          accent: 'pink',
          content: 'badly → worse',
          example: 'He did the test worse than I expected.',
        },
        {
          title: 'Far',
          accent: 'blue',
          content: 'far → farther / further',
          example: 'My uncle travels farther than my father.',
        },
        {
          title: 'Little / Much',
          accent: 'orange',
          content: 'little → less; much → more',
          example: 'People in the countryside may spend less.',
        },
      ],
    },
    {
      id: 's11',
      title: 'Các dạng câu',
      subtitle: 'So sánh hơn của trạng từ trong khẳng định, phủ định và nghi vấn.',
      layout: 'cards',
      cards: [
        {
          title: 'Khẳng định',
          accent: 'orange',
          content: 'S + V + adv-er / more adv + than + N',
          example: 'He runs faster than me.',
        },
        {
          title: 'Phủ định',
          accent: 'pink',
          content: 'S + do/does/did not + V + comparative adverb + than + N',
          example: 'He doesn’t work harder than his brother.',
        },
        {
          title: 'Nghi vấn',
          accent: 'blue',
          content: 'Do/Does/Did + S + V + comparative adverb + than + N?',
          example: 'Does she speak more clearly than you?',
        },
      ],
    },
    {
      id: 's12',
      title: 'So sánh cách làm việc',
      subtitle: 'Dùng trạng từ để so sánh cách một người làm việc.',
      layout: 'cards',
      cards: [
        {
          title: 'Farmers',
          accent: 'orange',
          content: 'work harder',
          example: 'Farmers work harder than office workers.',
        },
        {
          title: 'Driving',
          accent: 'blue',
          content: 'drive more carefully',
          example: 'My father drives more carefully than my brother.',
        },
        {
          title: 'Study',
          accent: 'green',
          content: 'study harder',
          example: 'She studies harder than her classmates.',
        },
        {
          title: 'Cooking',
          accent: 'pink',
          content: 'cook better',
          example: 'My grandmother cooks better than anyone in my family.',
        },
      ],
    },
    {
      id: 's13',
      title: 'So sánh nông thôn và thành phố',
      subtitle: 'Dùng trạng từ để nói cách sống và sinh hoạt.',
      layout: 'cards',
      cards: [
        {
          title: 'Live',
          accent: 'green',
          content: 'live more peacefully',
          example: 'People in the countryside live more peacefully than people in the city.',
        },
        {
          title: 'Play',
          accent: 'blue',
          content: 'play more freely',
          example: 'Children in the countryside play more freely than children in the city.',
        },
        {
          title: 'Travel',
          accent: 'orange',
          content: 'travel faster',
          example: 'People in big cities usually travel faster than people in villages.',
        },
        {
          title: 'Talk',
          accent: 'pink',
          content: 'talk more warmly',
          example: 'Villagers often talk to each other more warmly than city people.',
        },
      ],
    },
    {
      id: 's14',
      title: 'So sánh cách di chuyển',
      subtitle: 'Nói về tốc độ, độ an toàn và thói quen đi lại.',
      layout: 'cards',
      cards: [
        {
          title: 'Fast',
          accent: 'orange',
          content: 'move faster',
          example: 'Motorbikes move faster than bicycles.',
        },
        {
          title: 'Slow',
          accent: 'blue',
          content: 'move more slowly',
          example: 'Buffalo carts move more slowly than motorbikes.',
        },
        {
          title: 'Safe',
          accent: 'green',
          content: 'walk more safely',
          example: 'People walk more safely on narrow village roads.',
        },
        {
          title: 'Early',
          accent: 'pink',
          content: 'get there earlier',
          example: 'I get there earlier than my cousin.',
        },
      ],
    },
    {
      id: 's15',
      title: 'Dấu hiệu nhận biết',
      subtitle: 'Các dấu hiệu thường có trong câu so sánh hơn của trạng từ.',
      layout: 'cards',
      cards: [
        {
          title: 'Than',
          accent: 'orange',
          content: 'Dấu hiệu so sánh hơn.',
          example: 'He works harder than me.',
        },
        {
          title: 'More + adverb',
          accent: 'blue',
          content: 'Dùng với trạng từ dài.',
          example: 'She speaks more clearly than him.',
        },
        {
          title: 'Adverb-er',
          accent: 'green',
          content: 'Dùng với một số trạng từ ngắn.',
          example: 'He runs faster than his friend.',
        },
        {
          title: 'Better / worse',
          accent: 'pink',
          content: 'Dạng bất quy tắc.',
          example: 'She sings better than me.',
        },
      ],
    },
    {
      id: 's16',
      title: 'Phần 2',
      subtitle: 'Adjective vs Adverb',
      layout: 'section-cover',
      accent: 'pink',
    },
    {
      id: 's17',
      title: 'Tính từ hay trạng từ?',
      subtitle: 'Tính từ miêu tả danh từ; trạng từ miêu tả hành động.',
      layout: 'cards',
      cards: [
        {
          title: 'Adjective',
          accent: 'pink',
          content: 'Bổ nghĩa cho danh từ / người / vật.',
          example: 'The countryside is quieter than the city.',
        },
        {
          title: 'Adverb',
          accent: 'blue',
          content: 'Bổ nghĩa cho động từ / hành động.',
          example: 'People live more quietly in the countryside.',
        },
        {
          title: 'Peaceful',
          accent: 'orange',
          content: 'peaceful miêu tả countryside; peacefully miêu tả live.',
          example: 'People live peacefully.',
        },
      ],
    },
    {
      id: 's18',
      title: 'Cùng gốc, khác vai trò',
      subtitle: 'So sánh tính từ và trạng từ trong cùng một ý.',
      layout: 'cards',
      cards: [
        {
          title: 'Comparative adjective',
          accent: 'pink',
          content: 'more peaceful than',
          example: 'The countryside is more peaceful than the city.',
        },
        {
          title: 'Comparative adverb',
          accent: 'blue',
          content: 'more peacefully than',
          example: 'People in the countryside live more peacefully than people in the city.',
        },
      ],
    },
    {
      id: 's19',
      title: 'Từ vừa là tính từ vừa là trạng từ',
      subtitle: 'Một số từ không thêm -ly khi dùng làm trạng từ.',
      layout: 'cards',
      cards: [
        {
          title: 'Fast',
          accent: 'orange',
          content: 'a fast car / run fast',
          example: 'He runs faster than me.',
        },
        {
          title: 'Hard',
          accent: 'blue',
          content: 'hard work / work hard',
          example: 'Farmers work harder than many people.',
        },
        {
          title: 'Late',
          accent: 'pink',
          content: 'a late bus / arrive late',
          example: 'He arrived later than me.',
        },
        {
          title: 'Early',
          accent: 'green',
          content: 'an early morning / get up early',
          example: 'She gets up earlier than her brother.',
        },
      ],
    },
    {
      id: 's20',
      title: 'Lưu ý quan trọng',
      subtitle: 'Những lỗi cần tránh khi dùng comparative adverbs.',
      layout: 'cards',
      cards: [
        {
          title: 'Không more + -er',
          accent: 'pink',
          content: 'Trạng từ ngắn đã thêm -er thì không dùng more.',
          example: 'He runs faster than me.',
        },
        {
          title: 'Trạng từ dài dùng more',
          accent: 'blue',
          content: 'Không thêm -er vào trạng từ dài.',
          example: 'She speaks more clearly than him.',
        },
        {
          title: 'Không quên than',
          accent: 'orange',
          content: 'Câu so sánh hơn thường cần than.',
          example: 'He works harder than his brother.',
        },
        {
          title: 'Sau do/does/did',
          accent: 'green',
          content: 'Động từ chính giữ nguyên.',
          example: 'Does he work harder than you?',
        },
      ],
    },
    {
      id: 's21',
      title: 'Good hay Well?',
      subtitle: 'Good là tính từ; well là trạng từ.',
      layout: 'cards',
      cards: [
        {
          title: 'Good',
          accent: 'pink',
          content: 'Miêu tả danh từ.',
          example: 'She is a good singer.',
        },
        {
          title: 'Well',
          accent: 'blue',
          content: 'Miêu tả hành động.',
          example: 'She sings well.',
        },
        {
          title: 'Comparative',
          accent: 'green',
          content: 'well → better',
          example: 'She sings better than me.',
        },
      ],
    },
    {
      id: 's22',
      title: 'Ví dụ minh họa',
      subtitle: 'Nhìn trạng từ và chọn dạng so sánh đúng.',
      layout: 'cards',
      cards: [
        {
          title: 'Hard',
          accent: 'orange',
          content: 'hard là trạng từ ngắn.',
          example: 'Farmers work harder than office workers.',
        },
        {
          title: 'Peacefully',
          accent: 'blue',
          content: 'peacefully là trạng từ dài.',
          example: 'People live more peacefully than before.',
        },
        {
          title: 'Slowly',
          accent: 'pink',
          content: 'slowly dùng more.',
          example: 'My grandfather walks more slowly than my father.',
        },
        {
          title: 'Well',
          accent: 'green',
          content: 'well có dạng so sánh better.',
          example: 'She speaks English better than last year.',
        },
      ],
    },
    {
      id: 's23',
      title: 'Phần 3',
      subtitle: 'Life in the Countryside Vocabulary',
      layout: 'section-cover',
      accent: 'blue',
    },
    {
      id: 's24',
      title: 'Địa điểm ở nông thôn',
      subtitle: 'Từ vựng giúp miêu tả countryside.',
      layout: 'cards',
      cards: [
        {
          title: 'Places',
          accent: 'blue',
          bullets: ['countryside', 'village', 'farm', 'market'],
        },
        {
          title: 'Nature',
          accent: 'green',
          bullets: ['field', 'rice field', 'river', 'mountain'],
        },
        {
          title: 'Landscape',
          accent: 'orange',
          bullets: ['forest', 'path', 'pond', 'garden'],
        },
        {
          title: 'Example',
          accent: 'pink',
          bullets: ['Farmers work in the fields.', 'Villagers go to the market early.'],
        },
      ],
    },
    {
      id: 's25',
      title: 'Hoạt động ở nông thôn',
      subtitle: 'Các hoạt động thường gặp trong village life.',
      layout: 'cards',
      cards: [
        {
          title: 'Farm work',
          accent: 'green',
          bullets: ['grow rice', 'harvest crops', 'pick fruit'],
        },
        {
          title: 'Animals',
          accent: 'orange',
          bullets: ['raise cattle', 'feed animals', 'collect eggs', 'herd buffaloes'],
        },
        {
          title: 'Leisure',
          accent: 'blue',
          bullets: ['go fishing', 'fly kites', 'ride a buffalo'],
        },
        {
          title: 'Movement',
          accent: 'pink',
          bullets: ['walk along the path', 'go to the market early'],
        },
      ],
    },
    {
      id: 's26',
      title: 'Trạng từ thường dùng',
      subtitle: 'Các trạng từ hay dùng để so sánh trong Unit 2.',
      layout: 'cards',
      cards: [
        {
          title: 'Short',
          accent: 'orange',
          bullets: ['fast → faster', 'hard → harder', 'early → earlier'],
        },
        {
          title: 'Long',
          accent: 'blue',
          bullets: ['slowly → more slowly', 'carefully → more carefully'],
        },
        {
          title: 'Life',
          accent: 'green',
          bullets: ['peacefully → more peacefully', 'happily → more happily'],
        },
        {
          title: 'Irregular',
          accent: 'pink',
          bullets: ['well → better', 'badly → worse'],
        },
      ],
    },
    {
      id: 's27',
      title: 'Tính từ miêu tả nông thôn',
      subtitle: 'Dùng để nói về cảnh vật và con người.',
      layout: 'cards',
      cards: [
        {
          title: 'Atmosphere',
          accent: 'green',
          bullets: ['peaceful', 'quiet', 'fresh', 'relaxing'],
        },
        {
          title: 'People',
          accent: 'orange',
          bullets: ['friendly', 'hard-working', 'simple'],
        },
        {
          title: 'Scenery',
          accent: 'blue',
          bullets: ['beautiful', 'green', 'spacious'],
        },
        {
          title: 'Culture',
          accent: 'pink',
          bullets: ['traditional', 'country life', 'village customs'],
        },
      ],
    },
    {
      id: 's28',
      title: 'Cấu trúc giao tiếp',
      subtitle: 'Ba mẫu câu dùng nhiều trong Unit 2.',
      layout: 'cards',
      cards: [
        {
          title: 'So sánh cách sống',
          accent: 'green',
          content: 'S + V + more + adverb + than + N.',
          example: 'People in the countryside live more peacefully than people in the city.',
        },
        {
          title: 'So sánh cách làm việc',
          accent: 'orange',
          content: 'S + V + adv-er / more adv + than + N.',
          example: 'Farmers work harder than many people think.',
        },
        {
          title: 'Hỏi cách làm',
          accent: 'blue',
          content: 'How + do/does + S + V?',
          example: 'How do people live in the countryside?',
        },
      ],
    },
    {
      id: 's29',
      title: 'Luyện tập nhanh',
      subtitle: 'Điền dạng so sánh hơn của trạng từ.',
      layout: 'practice',
      accent: 'orange',
      bullets: [
        { content: 'Farmers work _____ than office workers. (hard)' },
        { content: 'People in the countryside live _____ than people in the city. (peacefully)' },
        { content: 'My grandfather walks _____ than my father. (slowly)' },
        { content: 'She sings _____ than her sister. (well)' },
      ],
      examples: ['harder', 'more peacefully', 'more slowly', 'better'],
    },
    {
      id: 's30',
      title: 'Unit 2 Recap',
      subtitle: 'Life in the Countryside',
      layout: 'practice',
      accent: 'purple',
      bullets: [
        { content: 'Trạng từ bổ nghĩa cho động từ và cho biết hành động được làm như thế nào.' },
        { content: 'Trạng từ ngắn thường thêm -er: fast → faster, hard → harder.' },
        { content: 'Trạng từ dài, đặc biệt đuôi -ly, dùng more: more peacefully, more carefully.' },
        { content: 'Một số trạng từ bất quy tắc cần nhớ: well → better, badly → worse.' },
      ],
      examples: [
        'Farmers work harder than office workers.',
        'Villagers drive more carefully than tourists.',
        'She speaks English better than last year.',
      ],
    },
  ],
};

export default deck;
