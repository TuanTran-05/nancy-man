import { LessonDeck } from '../../../types';

const deck: LessonDeck = {
  id: 'gs-g8-u4-ethnic-groups-of-viet-nam',
  curriculumFamily: 'global-success',
  grade: 8,
  unitNumber: 4,
  title: 'Grammar Grade 8 - Unit 4: Ethnic Groups of Viet Nam',
  description:
    'Bài giảng Unit 4 Global Success 8 về Yes / No questions, Wh-questions, countable and uncountable nouns và từ vựng Ethnic Groups of Viet Nam.',
  createdAt: '2026-05-18T00:00:00.000Z',
  slides: [
    {
      id: 's1',
      title: 'GRAMMAR GRADE 8',
      subtitle: 'UNIT 4: ETHNIC GROUPS OF VIET NAM',
      label: 'NỘI DUNG BÀI HỌC:',
      layout: 'outline',
      cards: [
        {
          title: 'YES / NO & WH-QUESTIONS',
          subtitle: '(Câu hỏi Yes / No và Wh-)',
          accent: 'orange',
        },
        {
          title: 'COUNTABLE & UNCOUNTABLE NOUNS',
          subtitle: '(Danh từ đếm được và không đếm được)',
          accent: 'pink',
        },
        {
          title: 'ETHNIC GROUPS VOCABULARY',
          subtitle: '(Từ vựng các dân tộc ở Việt Nam)',
          accent: 'blue',
        },
      ],
    },
    {
      id: 's2',
      title: 'Mục tiêu bài học',
      layout: 'objectives',
      bullets: [
        { content: 'Đặt và trả lời câu hỏi Yes / No về dân tộc, lễ hội, nhà ở và văn hóa.' },
        { content: 'Dùng Wh-questions để hỏi nơi sống, trang phục, phong tục, lý do và số lượng.' },
        { content: 'Phân biệt danh từ đếm được và không đếm được trong chủ đề ethnic groups.' },
        { content: 'Dùng đúng many, much, a lot of, how many và how much.' },
      ],
    },
    {
      id: 's3',
      title: 'Phần 1',
      subtitle: 'Yes / No Questions',
      layout: 'section-cover',
      accent: 'orange',
    },
    {
      id: 's4',
      title: 'Yes / No Questions là gì?',
      subtitle: 'Câu hỏi có thể trả lời bằng Yes hoặc No.',
      layout: 'cards',
      cards: [
        {
          title: 'To be',
          accent: 'orange',
          content: 'Am / Is / Are / Was / Were + S + ...?',
          example: 'Are the costumes colourful?',
        },
        {
          title: 'Present Simple',
          accent: 'blue',
          content: 'Do / Does + S + V nguyên mẫu?',
          example: 'Do the Ede live in stilt houses?',
        },
        {
          title: 'Past Simple',
          accent: 'pink',
          content: 'Did + S + V nguyên mẫu?',
          example: 'Did you visit the village last year?',
        },
        {
          title: 'Modal verbs',
          accent: 'green',
          content: 'Can / Should / Must / Will + S + V?',
          example: 'Can you speak the language?',
        },
      ],
    },
    {
      id: 's5',
      title: 'Yes / No với To Be',
      subtitle: 'Dùng khi câu hỏi có be hoặc there is / there are.',
      layout: 'cards',
      cards: [
        {
          title: 'Is',
          accent: 'orange',
          content: 'Is + singular subject + ...?',
          example: 'Is the festival important to the villagers?',
        },
        {
          title: 'Are',
          accent: 'blue',
          content: 'Are + plural subject + ...?',
          example: 'Are traditional costumes colourful?',
        },
        {
          title: 'There are',
          accent: 'green',
          content: 'Are there + plural noun + ...?',
          example: 'Are there many ethnic groups in Viet Nam?',
        },
        {
          title: 'Place',
          accent: 'pink',
          content: 'Is + S + preposition + place?',
          example: 'Is the communal house in the centre of the village?',
        },
      ],
    },
    {
      id: 's6',
      title: 'Trả lời với To Be',
      subtitle: 'Câu trả lời ngắn dùng lại đúng be.',
      layout: 'cards',
      cards: [
        {
          title: 'Is it...?',
          accent: 'orange',
          content: 'Yes, it is. / No, it isn’t.',
          example: 'Is the costume beautiful? Yes, it is.',
        },
        {
          title: 'Are they...?',
          accent: 'blue',
          content: 'Yes, they are. / No, they aren’t.',
          example: 'Are the houses made of wood? Yes, they are.',
        },
        {
          title: 'Are there...?',
          accent: 'green',
          content: 'Yes, there are. / No, there aren’t.',
          example: 'Are there many customs? No, there aren’t.',
        },
      ],
    },
    {
      id: 's7',
      title: 'Yes / No với Present Simple',
      subtitle: 'Dùng Do / Does để hỏi về thói quen, sự thật hoặc đặc điểm hiện tại.',
      layout: 'explain',
      accent: 'blue',
      formula: 'Do / Does + S + V nguyên mẫu + ...?',
      bullets: [
        { content: 'I / You / We / They dùng Do.' },
        { content: 'He / She / It dùng Does.' },
        { content: 'Sau Do / Does, động từ chính giữ nguyên.' },
      ],
      examples: [
        'Do the Thai live in stilt houses?',
        'Do the Hmong wear colourful clothes?',
        'Does your village have a traditional festival?',
      ],
    },
    {
      id: 's8',
      title: 'Trả lời với Do / Does',
      subtitle: 'Dùng lại trợ động từ trong câu hỏi.',
      layout: 'cards',
      cards: [
        {
          title: 'Do they...?',
          accent: 'blue',
          content: 'Yes, they do. / No, they don’t.',
          example: 'Do the Thai live in stilt houses? Yes, they do.',
        },
        {
          title: 'Does she...?',
          accent: 'pink',
          content: 'Yes, she does. / No, she doesn’t.',
          example: 'Does she wear traditional clothes? No, she doesn’t.',
        },
        {
          title: 'Ghi nhớ',
          accent: 'orange',
          content: 'Không trả lời Yes, they are cho câu hỏi Do.',
          example: 'Do they live there? Yes, they do.',
        },
      ],
    },
    {
      id: 's9',
      title: 'Yes / No với Past Simple',
      subtitle: 'Dùng Did để hỏi về trải nghiệm hoặc hoạt động trong quá khứ.',
      layout: 'explain',
      accent: 'pink',
      formula: 'Did + S + V nguyên mẫu + ...?',
      bullets: [
        { content: 'Dùng với mốc quá khứ như last summer, yesterday, last year.' },
        { content: 'Sau Did, động từ chính luôn ở dạng nguyên mẫu.' },
        { content: 'Trả lời ngắn bằng did hoặc didn’t.' },
      ],
      examples: [
        'Did you visit an ethnic village last summer?',
        'Did they join the festival yesterday?',
        'Did your class learn about the Cham people?',
      ],
    },
    {
      id: 's10',
      title: 'Yes / No với Modal Verbs',
      subtitle: 'Sau modal verb, động từ chính giữ nguyên.',
      layout: 'cards',
      cards: [
        {
          title: 'Can',
          accent: 'blue',
          content: 'Can + S + V?',
          example: 'Can you name some ethnic groups in Viet Nam?',
        },
        {
          title: 'Should',
          accent: 'green',
          content: 'Should + S + V?',
          example: 'Should we respect different cultures?',
        },
        {
          title: 'Will',
          accent: 'pink',
          content: 'Will + S + V?',
          example: 'Will you visit the museum next week?',
        },
      ],
    },
    {
      id: 's11',
      title: 'Phần 2',
      subtitle: 'Wh-questions',
      layout: 'section-cover',
      accent: 'blue',
    },
    {
      id: 's12',
      title: 'Wh-questions là gì?',
      subtitle: 'Câu hỏi bắt đầu bằng từ để hỏi và cần câu trả lời có thông tin cụ thể.',
      layout: 'cards',
      cards: [
        {
          title: 'What / Which',
          accent: 'orange',
          bullets: ['What do they wear?', 'Which ethnic group has this costume?'],
        },
        {
          title: 'Where / When',
          accent: 'blue',
          bullets: ['Where do the Hmong live?', 'When is the festival held?'],
        },
        {
          title: 'Who / Why',
          accent: 'pink',
          bullets: ['Who lives in this village?', 'Why do people celebrate this festival?'],
        },
        {
          title: 'How',
          accent: 'green',
          bullets: ['How do they make baskets?', 'How many ethnic groups are there?'],
        },
      ],
    },
    {
      id: 's13',
      title: 'Wh-question với To Be',
      subtitle: 'Dùng khi câu hỏi có động từ be.',
      layout: 'explain',
      accent: 'blue',
      formula: 'Wh-word + am / is / are + S + ...?',
      bullets: [
        { content: 'Dùng để hỏi tên, vị trí, thời gian hoặc đặc điểm.' },
        { content: 'Be đứng trước chủ ngữ sau Wh-word.' },
        { content: 'Câu trả lời không bắt đầu bằng Yes hoặc No.' },
      ],
      examples: [
        'What is the name of this ethnic group?',
        'Where is the communal house?',
        'When is the festival?',
        'How old are these traditions?',
      ],
    },
    {
      id: 's14',
      title: 'Wh-question với động từ thường',
      subtitle: 'Dùng do / does với hiện tại đơn.',
      layout: 'explain',
      accent: 'orange',
      formula: 'Wh-word + do / does + S + V nguyên mẫu + ...?',
      bullets: [
        { content: 'Do / does đứng sau Wh-word.' },
        { content: 'Sau do / does, động từ chính giữ nguyên.' },
        { content: 'Dùng nhiều để hỏi nơi sống, trang phục, cách làm và lý do.' },
      ],
      examples: [
        'Where do the Hmong live?',
        'What do the Thai wear at festivals?',
        'How do people make traditional baskets?',
      ],
    },
    {
      id: 's15',
      title: 'Wh-question với Past Simple',
      subtitle: 'Dùng did để hỏi thông tin trong quá khứ.',
      layout: 'cards',
      cards: [
        {
          title: 'Where',
          accent: 'blue',
          content: 'Where + did + S + V?',
          example: 'Where did you visit last summer?',
        },
        {
          title: 'What',
          accent: 'orange',
          content: 'What + did + S + V?',
          example: 'What did you learn about the Muong people?',
        },
        {
          title: 'When / Who',
          accent: 'pink',
          content: 'When / Who + did + S + V?',
          example: 'Who did you meet in the village?',
        },
      ],
    },
    {
      id: 's16',
      title: 'Cách dùng từng Wh-word',
      subtitle: 'Chọn đúng từ hỏi theo thông tin cần biết.',
      layout: 'cards',
      cards: [
        {
          title: 'What',
          accent: 'orange',
          content: 'Hỏi sự vật, hoạt động hoặc đặc điểm.',
          example: 'What traditional food do they eat?',
        },
        {
          title: 'Where',
          accent: 'blue',
          content: 'Hỏi địa điểm.',
          example: 'Where do the Hmong live?',
        },
        {
          title: 'When',
          accent: 'green',
          content: 'Hỏi thời gian.',
          example: 'When is the festival held?',
        },
        {
          title: 'Why',
          accent: 'pink',
          content: 'Hỏi lý do.',
          example: 'Why should we protect ethnic cultures?',
        },
      ],
    },
    {
      id: 's17',
      title: 'How / How many / How much',
      subtitle: 'Ba nhóm câu hỏi rất thường gặp trong Unit 4.',
      layout: 'cards',
      cards: [
        {
          title: 'How',
          accent: 'green',
          content: 'Hỏi cách thức.',
          example: 'How do people make traditional clothes?',
        },
        {
          title: 'How many',
          accent: 'orange',
          content: 'Hỏi số lượng danh từ đếm được số nhiều.',
          example: 'How many ethnic groups are there in Viet Nam?',
        },
        {
          title: 'How much',
          accent: 'blue',
          content: 'Hỏi lượng không đếm được hoặc giá tiền.',
          example: 'How much is this traditional scarf?',
        },
      ],
    },
    {
      id: 's18',
      title: 'Lưu ý với Questions',
      subtitle: 'Những lỗi hay gặp khi đặt câu hỏi.',
      layout: 'cards',
      cards: [
        {
          title: 'Sau do / does / did',
          accent: 'orange',
          content: 'Động từ chính giữ nguyên.',
          example: 'Where does she live?',
        },
        {
          title: 'Wh-question',
          accent: 'blue',
          content: 'Không trả lời Yes / No.',
          example: 'Where do they live? They live in the mountains.',
        },
        {
          title: 'Short answer',
          accent: 'pink',
          content: 'Câu hỏi dùng trợ động từ nào, trả lời bằng trợ động từ đó.',
          example: 'Are the costumes colourful? Yes, they are.',
        },
      ],
    },
    {
      id: 's19',
      title: 'Ví dụ Questions',
      subtitle: 'Nhìn câu hỏi và nhận diện cấu trúc.',
      layout: 'cards',
      cards: [
        {
          title: 'Do',
          accent: 'orange',
          content: 'Yes / No ở hiện tại đơn.',
          example: 'Do the Thai live in stilt houses?',
        },
        {
          title: 'Where',
          accent: 'blue',
          content: 'Wh-question hỏi nơi sống.',
          example: 'Where do the Hmong live?',
        },
        {
          title: 'How many',
          accent: 'green',
          content: 'Hỏi danh từ đếm được số nhiều.',
          example: 'How many ethnic groups are there in Viet Nam?',
        },
      ],
    },
    {
      id: 's20',
      title: 'Phần 3',
      subtitle: 'Countable & Uncountable Nouns',
      layout: 'section-cover',
      accent: 'pink',
    },
    {
      id: 's21',
      title: 'Danh từ đếm được và không đếm được',
      subtitle: 'Dùng để nói về con người, dân tộc, trang phục, văn hóa và thông tin.',
      layout: 'cards',
      cards: [
        {
          title: 'Countable nouns',
          accent: 'orange',
          content: 'Có thể đếm trực tiếp bằng số.',
          example: 'an ethnic group, three villages',
        },
        {
          title: 'Uncountable nouns',
          accent: 'pink',
          content: 'Không đếm trực tiếp bằng số.',
          example: 'some information, a lot of rice',
        },
        {
          title: 'Unit 4 context',
          accent: 'blue',
          content: 'Dùng để nói về customs, festivals, food, culture.',
          example: 'Viet Nam has many ethnic groups.',
        },
      ],
    },
    {
      id: 's22',
      title: 'Countable Nouns',
      subtitle: 'Danh từ đếm được có số ít và số nhiều.',
      layout: 'cards',
      cards: [
        {
          title: 'People & places',
          accent: 'orange',
          bullets: ['an ethnic group → ethnic groups', 'a village → villages'],
        },
        {
          title: 'Culture',
          accent: 'blue',
          bullets: ['a custom → customs', 'a tradition → traditions', 'a festival → festivals'],
        },
        {
          title: 'Objects',
          accent: 'green',
          bullets: ['a costume → costumes', 'a basket → baskets', 'a house → houses'],
        },
        {
          title: 'Language / dance',
          accent: 'pink',
          bullets: ['a language → languages', 'a dance → dances'],
        },
      ],
    },
    {
      id: 's23',
      title: 'Quy tắc thêm -s / -es',
      subtitle: 'Chuyển danh từ đếm được sang số nhiều.',
      layout: 'cards',
      cards: [
        {
          title: 'Thêm -s',
          accent: 'orange',
          content: 'Danh từ thường thêm -s.',
          example: 'village → villages',
        },
        {
          title: 'Thêm -es',
          accent: 'pink',
          content: 'Tận cùng s, sh, ch, x thêm -es.',
          example: 'dress → dresses',
        },
        {
          title: 'y → ies',
          accent: 'blue',
          content: 'Phụ âm + y đổi y thành i + es.',
          example: 'ceremony → ceremonies',
        },
        {
          title: 'f / fe → ves',
          accent: 'green',
          content: 'Một số danh từ đổi f / fe thành ves.',
          example: 'scarf → scarves',
        },
      ],
    },
    {
      id: 's24',
      title: 'Uncountable Nouns',
      subtitle: 'Danh từ không đếm được thường không có dạng số nhiều.',
      layout: 'cards',
      cards: [
        {
          title: 'Culture words',
          accent: 'blue',
          bullets: ['culture', 'information', 'knowledge', 'tradition'],
        },
        {
          title: 'Materials',
          accent: 'orange',
          bullets: ['silk', 'bamboo', 'wood', 'water'],
        },
        {
          title: 'Food / art',
          accent: 'green',
          bullets: ['food', 'rice', 'music', 'clothing'],
        },
        {
          title: 'Advice / work',
          accent: 'pink',
          bullets: ['advice', 'work', 'furniture'],
        },
      ],
    },
    {
      id: 's25',
      title: 'Lưu ý với uncountable nouns',
      subtitle: 'Không thêm -s và không dùng a / an trực tiếp.',
      layout: 'cards',
      cards: [
        {
          title: 'Information',
          accent: 'pink',
          content: 'Không dùng informations.',
          example: 'We need a lot of information.',
        },
        {
          title: 'Music',
          accent: 'blue',
          content: 'Không dùng musics khi nói chung.',
          example: 'They play traditional music.',
        },
        {
          title: 'Advice',
          accent: 'orange',
          content: 'Không dùng an advice.',
          example: 'She gave me some advice.',
        },
      ],
    },
    {
      id: 's26',
      title: 'Cách đếm danh từ không đếm được',
      subtitle: 'Dùng đơn vị đo lường hoặc cụm lượng từ.',
      layout: 'cards',
      cards: [
        {
          title: 'Information / advice',
          accent: 'blue',
          bullets: ['a piece of information', 'a piece of advice'],
        },
        {
          title: 'Food / drink',
          accent: 'green',
          bullets: ['a bowl of rice', 'a glass of water', 'two bottles of water'],
        },
        {
          title: 'Culture objects',
          accent: 'orange',
          bullets: ['a piece of clothing', 'a piece of music', 'a bamboo basket'],
        },
      ],
    },
    {
      id: 's27',
      title: 'Some / Any / Many / Much',
      subtitle: 'Chọn lượng từ theo loại danh từ.',
      layout: 'cards',
      cards: [
        {
          title: 'Some / Any',
          accent: 'blue',
          content: 'Dùng với cả danh từ đếm được số nhiều và không đếm được.',
          example: 'some costumes / some rice',
        },
        {
          title: 'Many / A few',
          accent: 'orange',
          content: 'Dùng với danh từ đếm được số nhiều.',
          example: 'many ethnic groups / a few villages',
        },
        {
          title: 'Much / A little',
          accent: 'pink',
          content: 'Dùng với danh từ không đếm được.',
          example: 'much information / a little water',
        },
        {
          title: 'A lot of',
          accent: 'green',
          content: 'Dùng với cả hai loại danh từ.',
          example: 'a lot of festivals / a lot of music',
        },
      ],
    },
    {
      id: 's28',
      title: 'How many và How much',
      subtitle: 'Hỏi số lượng theo loại danh từ.',
      layout: 'cards',
      cards: [
        {
          title: 'How many',
          accent: 'orange',
          content: 'How many + plural countable noun + ...?',
          example: 'How many ethnic groups are there in Viet Nam?',
        },
        {
          title: 'How much',
          accent: 'blue',
          content: 'How much + uncountable noun + ...?',
          example: 'How much rice do they need?',
        },
        {
          title: 'Price',
          accent: 'green',
          content: 'How much is / are + noun?',
          example: 'How much is this scarf?',
        },
      ],
    },
    {
      id: 's29',
      title: 'Countable vs Uncountable',
      subtitle: 'So sánh nhanh để tránh nhầm.',
      layout: 'cards',
      cards: [
        {
          title: 'Countable',
          accent: 'orange',
          bullets: ['a costume', 'three villages', 'many ethnic groups', 'some baskets'],
        },
        {
          title: 'Uncountable',
          accent: 'pink',
          bullets: ['some clothing', 'much information', 'a lot of culture', 'some music'],
        },
        {
          title: 'Question words',
          accent: 'blue',
          bullets: ['How many + countable plural', 'How much + uncountable'],
        },
      ],
    },
    {
      id: 's30',
      title: 'Lưu ý đặc biệt',
      subtitle: 'Một số danh từ dễ nhầm trong Unit 4.',
      layout: 'cards',
      cards: [
        {
          title: 'People',
          accent: 'orange',
          content: 'People là danh từ số nhiều.',
          example: 'There are many people at the festival.',
        },
        {
          title: 'Clothes vs clothing',
          accent: 'blue',
          content: 'Clothes thường số nhiều; clothing không đếm được.',
          example: 'Traditional clothing is colourful.',
        },
        {
          title: 'Culture',
          accent: 'pink',
          content: 'Culture có thể không đếm được khi nói chung; cultures là nhiều nền văn hóa.',
          example: 'We should respect different cultures.',
        },
      ],
    },
    {
      id: 's31',
      title: 'Ví dụ Nouns',
      subtitle: 'Nhìn danh từ và chọn lượng từ đúng.',
      layout: 'cards',
      cards: [
        {
          title: 'Ethnic groups',
          accent: 'orange',
          content: 'Danh từ đếm được số nhiều.',
          example: 'There are 54 ethnic groups in Viet Nam.',
        },
        {
          title: 'Information',
          accent: 'blue',
          content: 'Danh từ không đếm được.',
          example: 'We need some information about the festival.',
        },
        {
          title: 'Costumes',
          accent: 'green',
          content: 'Danh từ đếm được số nhiều, dùng How many.',
          example: 'How many traditional costumes are there?',
        },
        {
          title: 'Rice',
          accent: 'pink',
          content: 'Danh từ không đếm được, dùng How much.',
          example: 'How much rice do they prepare?',
        },
      ],
    },
    {
      id: 's32',
      title: 'Phần 4',
      subtitle: 'Ethnic Groups Vocabulary',
      layout: 'section-cover',
      accent: 'blue',
    },
    {
      id: 's33',
      title: 'Dân tộc và cộng đồng',
      subtitle: 'Từ vựng nền tảng của Unit 4.',
      layout: 'cards',
      cards: [
        {
          title: 'Groups',
          accent: 'blue',
          bullets: ['ethnic group', 'ethnic minority', 'majority group'],
        },
        {
          title: 'Community',
          accent: 'green',
          bullets: ['community', 'villager', 'population'],
        },
        {
          title: 'Culture',
          accent: 'orange',
          bullets: ['language', 'culture', 'custom', 'tradition'],
        },
        {
          title: 'Examples',
          accent: 'pink',
          bullets: [
            'The Hmong are an ethnic minority group.',
            'Each community has its own customs.',
          ],
        },
      ],
    },
    {
      id: 's34',
      title: 'Đời sống và nhà ở',
      subtitle: 'Từ vựng về nơi sống và vật liệu.',
      layout: 'cards',
      cards: [
        {
          title: 'Housing',
          accent: 'orange',
          bullets: ['village', 'stilt house', 'communal house'],
        },
        {
          title: 'Materials',
          accent: 'green',
          bullets: ['bamboo', 'wood'],
        },
        {
          title: 'Landscape',
          accent: 'blue',
          bullets: ['field', 'mountain', 'valley', 'market'],
        },
        {
          title: 'Example',
          accent: 'pink',
          bullets: [
            'The communal house is in the centre.',
            'Many groups live in mountainous areas.',
          ],
        },
      ],
    },
    {
      id: 's35',
      title: 'Trang phục và đồ thủ công',
      subtitle: 'Từ vựng về costume, craft và handmade products.',
      layout: 'cards',
      cards: [
        {
          title: 'Clothes',
          accent: 'pink',
          bullets: ['costume', 'clothes', 'scarf', 'dress'],
        },
        {
          title: 'Patterns',
          accent: 'orange',
          bullets: ['pattern', 'colourful patterns', 'traditional dress'],
        },
        {
          title: 'Crafts',
          accent: 'green',
          bullets: ['basket', 'craft', 'jewellery'],
        },
        {
          title: 'Music',
          accent: 'blue',
          bullets: ['musical instrument', 'traditional music'],
        },
      ],
    },
    {
      id: 's36',
      title: 'Lễ hội và văn hóa',
      subtitle: 'Từ vựng dùng để nói về traditions and festivals.',
      layout: 'cards',
      cards: [
        {
          title: 'Festival',
          accent: 'orange',
          bullets: ['festival', 'ceremony', 'celebration'],
        },
        {
          title: 'Performance',
          accent: 'blue',
          bullets: ['folk dance', 'folk song', 'performance'],
        },
        {
          title: 'Culture',
          accent: 'green',
          bullets: ['traditional food', 'worship', 'heritage'],
        },
        {
          title: 'Example',
          accent: 'pink',
          bullets: ['The festival is held every year.', 'We should protect cultural heritage.'],
        },
      ],
    },
    {
      id: 's37',
      title: 'Tính từ miêu tả văn hóa',
      subtitle: 'Dùng để nhận xét trang phục, phong tục và làng bản.',
      layout: 'cards',
      cards: [
        {
          title: 'Culture',
          accent: 'orange',
          bullets: ['traditional', 'unique', 'diverse', 'meaningful'],
        },
        {
          title: 'People & place',
          accent: 'green',
          bullets: ['peaceful', 'friendly', 'mountainous'],
        },
        {
          title: 'Appearance',
          accent: 'pink',
          bullets: ['colourful', 'beautiful', 'important'],
        },
      ],
    },
    {
      id: 's38',
      title: 'Cấu trúc giao tiếp',
      subtitle: 'Các mẫu câu thường dùng trong Unit 4.',
      layout: 'cards',
      cards: [
        {
          title: 'Hỏi nơi sống',
          accent: 'blue',
          content: 'Where do / does + S + live?',
          example: 'Where do the Hmong live?',
        },
        {
          title: 'Hỏi trang phục',
          accent: 'pink',
          content: 'What do / does + S + wear?',
          example: 'What do people wear at festivals?',
        },
        {
          title: 'Hỏi số lượng',
          accent: 'orange',
          content: 'How many + countable plural noun + are there?',
          example: 'How many ethnic groups are there in Viet Nam?',
        },
        {
          title: 'Hỏi lượng / giá',
          accent: 'green',
          content: 'How much + uncountable noun...? / How much is...?',
          example: 'How much is this scarf?',
        },
      ],
    },
    {
      id: 's39',
      title: 'Luyện tập nhanh',
      subtitle: 'Điền từ hỏi hoặc lượng từ phù hợp.',
      layout: 'practice',
      accent: 'orange',
      bullets: [
        { content: '_____ do the Hmong live?' },
        { content: '_____ ethnic groups are there in Viet Nam?' },
        { content: 'We need some _____ about the festival.' },
        { content: 'There are many traditional _____ in the museum.' },
      ],
      examples: ['Where', 'How many', 'information', 'costumes'],
    },
    {
      id: 's40',
      title: 'Unit 4 Recap',
      subtitle: 'Ethnic Groups of Viet Nam',
      layout: 'practice',
      accent: 'purple',
      bullets: [
        { content: 'Yes / No questions trả lời bằng Yes hoặc No và dùng đúng trợ động từ.' },
        { content: 'Wh-questions hỏi thông tin cụ thể: what, where, when, who, why, how.' },
        { content: 'Countable nouns có số ít / số nhiều; uncountable nouns không đếm trực tiếp.' },
        {
          content:
            'How many dùng với danh từ đếm được số nhiều; how much dùng với danh từ không đếm được hoặc giá tiền.',
        },
      ],
      examples: [
        'Do the Thai live in stilt houses? Yes, they do.',
        'Where do the Hmong live?',
        'How much information do you know?',
      ],
    },
  ],
};

export default deck;
