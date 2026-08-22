import { LessonDeck } from '../../../types';

const deck: LessonDeck = {
  id: 'gs-g9-u9-english-in-the-world',
  curriculumFamily: 'global-success',
  grade: 9,
  unitNumber: 9,
  title: 'Grammar Grade 9 - Unit 9: English in the World',
  description:
    'Bài giảng Unit 9 Global Success 9 về defining relative clauses, relative pronouns and adverbs và từ vựng English in the World.',
  createdAt: '2026-05-18T00:00:00.000Z',
  slides: [
    {
      id: 's1',
      title: 'GRAMMAR GRADE 9',
      subtitle: 'UNIT 9: ENGLISH IN THE WORLD',
      label: 'NỘI DUNG BÀI HỌC:',
      layout: 'outline',
      cards: [
        {
          title: 'DEFINING RELATIVE CLAUSES',
          subtitle: '(Mệnh đề quan hệ xác định)',
          accent: 'blue',
        },
        {
          title: 'RELATIVE PRONOUNS & ADVERBS',
          subtitle: '(Đại từ quan hệ và trạng từ quan hệ)',
          accent: 'green',
        },
        {
          title: 'ENGLISH IN THE WORLD VOCABULARY',
          subtitle: '(Từ vựng tiếng Anh trên thế giới)',
          accent: 'purple',
        },
      ],
    },
    {
      id: 's2',
      title: 'Mục tiêu bài học',
      layout: 'objectives',
      bullets: [
        { content: 'Hiểu mệnh đề quan hệ xác định và vì sao thông tin này cần thiết trong câu.' },
        {
          content:
            'Dùng đúng who, whom, which, that, whose, where, when, why trong chủ đề English in the World.',
        },
        { content: 'Phân biệt defining và non-defining relative clauses, đặc biệt là dấu phẩy.' },
        {
          content: 'Lược bỏ đại từ quan hệ khi nó làm tân ngữ và tránh lặp lại chủ ngữ / tân ngữ.',
        },
      ],
    },
    {
      id: 's3',
      title: 'Phần 1',
      subtitle: 'Defining Relative Clauses',
      layout: 'section-cover',
      accent: 'blue',
    },
    {
      id: 's4',
      title: 'Defining Relative Clause là gì?',
      subtitle: 'Mệnh đề quan hệ xác định bổ sung thông tin cần thiết cho danh từ đứng trước.',
      layout: 'explain',
      accent: 'blue',
      formula: 'Noun + relative clause + main verb / complement',
      bullets: [
        {
          content:
            'Nếu bỏ mệnh đề này đi, người nghe có thể không biết chính xác người, vật, nơi chốn hoặc thời điểm nào.',
        },
        { content: 'Mệnh đề đứng ngay sau danh từ được bổ nghĩa.' },
        { content: 'Trong defining relative clauses, không dùng dấu phẩy.' },
      ],
      examples: [
        'The student who speaks English well is my classmate.',
        'The website which helps me learn vocabulary is very useful.',
        'This is the country where English is widely spoken.',
      ],
    },
    {
      id: 's5',
      title: 'Relative Clause là gì?',
      subtitle:
        'Mệnh đề quan hệ thường bắt đầu bằng who, whom, which, that, whose, where, when, why.',
      layout: 'cards',
      cards: [
        {
          title: 'Câu gốc 1',
          accent: 'blue',
          content: 'The teacher is very kind.',
        },
        {
          title: 'Câu gốc 2',
          accent: 'green',
          content: 'She teaches us English.',
        },
        {
          title: 'Câu nối',
          accent: 'purple',
          content: 'The teacher who teaches us English is very kind.',
        },
        {
          title: 'Phân tích',
          accent: 'orange',
          content: 'Who thay cho the teacher và đứng đầu mệnh đề quan hệ.',
        },
      ],
    },
    {
      id: 's6',
      title: 'Dùng để xác định người',
      subtitle: 'Cho biết rõ người nào đang được nói đến.',
      layout: 'cards',
      cards: [
        {
          title: 'Contest',
          accent: 'blue',
          content: 'The girl who won the English speaking contest is in my class.',
        },
        {
          title: 'Teacher',
          accent: 'green',
          content: 'The teacher who taught me pronunciation is very patient.',
        },
        {
          title: 'Students',
          accent: 'purple',
          content: 'The students who study English every day improve quickly.',
        },
      ],
    },
    {
      id: 's7',
      title: 'Dùng để xác định vật hoặc sự việc',
      subtitle: 'Cho biết rõ vật, công cụ học tập hoặc bài học nào.',
      layout: 'cards',
      cards: [
        {
          title: 'Dictionary',
          accent: 'blue',
          content: 'The dictionary which I bought yesterday is useful.',
        },
        {
          title: 'App',
          accent: 'green',
          content: 'The app which helps me practise pronunciation is free.',
        },
        {
          title: 'Lesson',
          accent: 'purple',
          content: 'The lesson that we studied last week was about English accents.',
        },
      ],
    },
    {
      id: 's8',
      title: 'Dùng để xác định nơi chốn',
      subtitle: 'Dùng where khi mệnh đề nói ai làm gì ở nơi đó.',
      layout: 'cards',
      cards: [
        {
          title: 'School',
          accent: 'blue',
          content: 'This is the school where I study English.',
        },
        {
          title: 'Country',
          accent: 'green',
          content: 'Singapore is a country where English is widely used.',
        },
        {
          title: 'Library',
          accent: 'purple',
          content: 'The library where we borrow English books is near my house.',
        },
      ],
    },
    {
      id: 's9',
      title: 'Dùng để xác định thời gian',
      subtitle: 'Dùng when khi mệnh đề nói sự việc xảy ra vào thời điểm đó.',
      layout: 'cards',
      cards: [
        {
          title: 'Day',
          accent: 'blue',
          content: 'I remember the day when I first spoke English to a foreigner.',
        },
        {
          title: 'Summer',
          accent: 'green',
          content: 'Summer is the time when many students join English courses.',
        },
        {
          title: 'Year',
          accent: 'purple',
          content: '2024 was the year when I started learning IELTS.',
        },
      ],
    },
    {
      id: 's10',
      title: 'Công thức với người',
      subtitle: 'Dùng who / whom / that sau danh từ chỉ người.',
      layout: 'explain',
      accent: 'blue',
      formula: 'Person + who / whom / that + V / S + V + ...',
      bullets: [
        { content: 'Who thường làm chủ ngữ trong mệnh đề quan hệ.' },
        { content: 'Whom thường làm tân ngữ trong văn viết trang trọng.' },
        { content: 'That có thể thay cho who / whom trong mệnh đề xác định.' },
      ],
      examples: [
        'The student who sits next to me speaks English fluently.',
        'The teacher that explains grammar clearly is popular.',
        'The foreigner whom we met yesterday was from Australia.',
      ],
    },
    {
      id: 's11',
      title: 'Công thức với vật / sự việc',
      subtitle: 'Dùng which / that sau danh từ chỉ vật, sự việc hoặc con vật.',
      layout: 'explain',
      accent: 'green',
      formula: 'Thing / idea + which / that + V / S + V + ...',
      bullets: [
        { content: 'Which dùng cho vật, sự việc, con vật.' },
        { content: 'That có thể thay cho which trong mệnh đề xác định.' },
        { content: 'Nếu which / that làm tân ngữ, có thể lược bỏ.' },
      ],
      examples: [
        'The book which explains English grammar is easy to understand.',
        'The video that I watched last night was about British English.',
        'The words which come from French are common in English.',
      ],
    },
    {
      id: 's12',
      title: 'Công thức với nơi chốn và thời gian',
      subtitle: 'Dùng where cho place, when cho time.',
      layout: 'cards',
      cards: [
        {
          title: 'Where',
          accent: 'green',
          content: 'Place + where + S + V + ...',
          example: 'This is the centre where I learn English.',
        },
        {
          title: 'Where',
          accent: 'blue',
          content: 'Country / school / centre / website + where + clause',
          example: 'Canada is a country where many people speak English and French.',
        },
        {
          title: 'When',
          accent: 'purple',
          content: 'Time + when + S + V + ...',
          example: 'Sunday is the day when I practise English online.',
        },
      ],
    },
    {
      id: 's13',
      title: 'Đặc điểm của defining relative clauses',
      subtitle: 'Thông tin cần thiết và không có dấu phẩy.',
      layout: 'cards',
      cards: [
        {
          title: 'Cần thiết',
          accent: 'blue',
          content: 'Mệnh đề giúp xác định rõ danh từ.',
          example: 'The student who won the prize is my friend.',
        },
        {
          title: 'Không dấu phẩy',
          accent: 'red',
          content: 'Mệnh đề gắn chặt với danh từ.',
          example: 'The book which I bought is useful.',
        },
        {
          title: 'Có thể dùng that',
          accent: 'green',
          content: 'That thay cho who / which trong nhiều trường hợp.',
          example: 'The app that I use is helpful.',
        },
        {
          title: 'Có thể lược bỏ',
          accent: 'purple',
          content: 'Nếu đại từ quan hệ làm tân ngữ.',
          example: 'The book I bought is useful.',
        },
      ],
    },
    {
      id: 's14',
      title: 'Không dùng dấu phẩy',
      subtitle: 'Defining relative clause cung cấp thông tin cần thiết.',
      layout: 'cards',
      cards: [
        {
          title: 'Đúng',
          accent: 'green',
          content: 'The student who speaks English well is my friend.',
        },
        {
          title: 'Đúng',
          accent: 'green',
          content: 'The app which helps me learn vocabulary is very popular.',
        },
        {
          title: 'Sai',
          accent: 'red',
          content: 'The student, who speaks English well, is my friend.',
        },
        {
          title: 'Sai',
          accent: 'red',
          content: 'The app, which helps me learn vocabulary, is very popular.',
        },
      ],
    },
    {
      id: 's15',
      title: 'Defining và Non-defining',
      subtitle: 'Unit 9 tập trung vào mệnh đề quan hệ xác định.',
      layout: 'cards',
      cards: [
        {
          title: 'Defining',
          accent: 'blue',
          content: 'Thông tin cần thiết, không có dấu phẩy.',
          example: 'The student who won the contest is my friend.',
        },
        {
          title: 'Non-defining',
          accent: 'green',
          content: 'Thông tin thêm, có dấu phẩy.',
          example: 'Lan, who won the contest, is my friend.',
        },
        {
          title: 'Ghi nhớ Unit 9',
          accent: 'orange',
          content: 'Với defining relative clauses, không đặt dấu phẩy trước mệnh đề quan hệ.',
        },
      ],
    },
    {
      id: 's16',
      title: 'Lược bỏ đại từ quan hệ',
      subtitle: 'Chỉ lược bỏ khi who / whom / which / that làm tân ngữ.',
      layout: 'explain',
      accent: 'purple',
      formula: 'Noun + S + V + ...',
      bullets: [
        { content: 'The book which I bought yesterday is useful.' },
        { content: 'The book I bought yesterday is useful.' },
        { content: 'The video that I watched last night helped me understand English accents.' },
        { content: 'The video I watched last night helped me understand English accents.' },
      ],
      examples: [
        'The teacher whom we met at the workshop was friendly.',
        'The teacher we met at the workshop was friendly.',
      ],
    },
    {
      id: 's17',
      title: 'Không lược bỏ khi làm chủ ngữ',
      subtitle: 'Nếu đại từ quan hệ là chủ ngữ trong mệnh đề, phải giữ lại.',
      layout: 'cards',
      cards: [
        {
          title: 'Đúng',
          accent: 'green',
          content: 'The student who won the prize is my friend.',
        },
        {
          title: 'Sai',
          accent: 'red',
          content: 'The student won the prize is my friend.',
        },
        {
          title: 'Đúng',
          accent: 'green',
          content: 'The website which teaches pronunciation is useful.',
        },
        {
          title: 'Sai',
          accent: 'red',
          content: 'The website teaches pronunciation is useful.',
        },
      ],
    },
    {
      id: 's18',
      title: 'Ví dụ phân tích',
      subtitle: 'Xác định vai trò của đại từ quan hệ.',
      layout: 'cards',
      cards: [
        {
          title: 'Who làm chủ ngữ',
          accent: 'blue',
          content: 'The student who speaks English fluently is my cousin.',
          example: 'Who thay cho the student và làm chủ ngữ của speaks.',
        },
        {
          title: 'Which làm tân ngữ',
          accent: 'green',
          content: 'The dictionary which I use every day is very helpful.',
          example: 'Có thể viết: The dictionary I use every day is very helpful.',
        },
        {
          title: 'Where chỉ nơi chốn',
          accent: 'purple',
          content: 'This is the place where I practise speaking English.',
          example: 'Where xác định rõ địa điểm nào.',
        },
      ],
    },
    {
      id: 's19',
      title: 'Phần 2',
      subtitle: 'Relative Pronouns & Adverbs',
      layout: 'section-cover',
      accent: 'green',
    },
    {
      id: 's20',
      title: 'Bảng tổng hợp',
      subtitle:
        'Relative pronouns thay cho người, vật, sở hữu; relative adverbs thay cho nơi chốn, thời gian, lý do.',
      layout: 'cards',
      cards: [
        {
          title: 'Pronouns',
          accent: 'green',
          content: 'who, whom, which, that, whose',
          example: 'The student who speaks English well is Mai.',
        },
        {
          title: 'Adverbs',
          accent: 'blue',
          content: 'where, when, why',
          example: 'This is the school where I study English.',
        },
        {
          title: 'Câu hỏi chọn từ',
          accent: 'purple',
          content: 'Nhìn danh từ trước mệnh đề và vai trò trong mệnh đề.',
          example: 'person, thing, place, time, reason',
        },
      ],
    },
    {
      id: 's21',
      title: 'Who',
      subtitle: 'Who dùng cho người, thường làm chủ ngữ.',
      layout: 'explain',
      accent: 'blue',
      formula: 'Person + who + V + ...',
      bullets: [
        { content: 'Sau who thường là động từ.' },
        { content: 'Who thay cho người đứng trước.' },
        { content: 'Dùng nhiều khi nói về learner, speaker, teacher, student.' },
      ],
      examples: [
        'The student who won the English contest is very confident.',
        'The teacher who teaches pronunciation is from Canada.',
        'People who speak English well have more opportunities.',
      ],
    },
    {
      id: 's22',
      title: 'Whom',
      subtitle: 'Whom dùng cho người, thường làm tân ngữ.',
      layout: 'explain',
      accent: 'purple',
      formula: 'Person + whom + S + V + ...',
      bullets: [
        { content: 'Sau whom thường có chủ ngữ riêng.' },
        { content: 'Trong văn nói, who thường thay cho whom.' },
        { content: 'Trong bài ngữ pháp trang trọng, dùng whom khi đại từ quan hệ là tân ngữ.' },
      ],
      examples: [
        'The speaker whom we invited is from Singapore.',
        'The teacher whom I admire speaks English fluently.',
        'The student whom the teacher praised was very happy.',
      ],
    },
    {
      id: 's23',
      title: 'Which',
      subtitle: 'Which dùng cho vật, sự việc hoặc con vật.',
      layout: 'explain',
      accent: 'green',
      formula: 'Thing + which + V / S + V + ...',
      bullets: [
        { content: 'Which có thể làm chủ ngữ hoặc tân ngữ.' },
        { content: 'Dùng với course, dictionary, website, video, app, book.' },
        { content: 'Trong defining clause, which có thể được thay bằng that.' },
      ],
      examples: [
        'The course which starts next week is for beginners.',
        'The dictionary which I bought has many examples.',
        'The website which teaches English pronunciation is useful.',
      ],
    },
    {
      id: 's24',
      title: 'That',
      subtitle: 'That có thể thay cho who, whom, which trong mệnh đề xác định.',
      layout: 'cards',
      cards: [
        {
          title: 'Person',
          accent: 'blue',
          content: 'The student that won the prize is my friend.',
        },
        {
          title: 'Thing',
          accent: 'green',
          content: 'The app that helps me learn vocabulary is free.',
        },
        {
          title: 'Object',
          accent: 'purple',
          content: 'The book that I borrowed is about English around the world.',
        },
        {
          title: 'Speaking style',
          accent: 'orange',
          content: 'That thường dùng trong văn nói và defining relative clauses.',
        },
      ],
    },
    {
      id: 's25',
      title: 'Khi nào thường dùng That?',
      subtitle: 'That rất phổ biến sau một số từ nhấn mạnh.',
      layout: 'cards',
      cards: [
        {
          title: 'The best',
          accent: 'green',
          content: 'This is the best English book that I have ever read.',
        },
        {
          title: 'The only',
          accent: 'blue',
          content: 'The only student that answered the question was Nam.',
        },
        {
          title: 'Everything',
          accent: 'purple',
          content: 'Everything that he said was useful.',
        },
      ],
    },
    {
      id: 's26',
      title: 'Whose',
      subtitle: 'Whose chỉ sở hữu và sau whose luôn có danh từ.',
      layout: 'explain',
      accent: 'orange',
      formula: 'Noun + whose + noun + V + ...',
      bullets: [
        { content: 'Whose có nghĩa là của ai / của cái gì.' },
        { content: 'Không dùng thêm his / her / its / their sau whose.' },
        { content: 'Dùng được với người, tổ chức, quốc gia hoặc sự vật trong văn viết.' },
      ],
      examples: [
        'The girl whose English is excellent won the speaking contest.',
        'The teacher whose lessons are interesting is very popular.',
        'The country whose official language is English attracts many learners.',
      ],
    },
    {
      id: 's27',
      title: 'Lỗi với Whose',
      subtitle: 'Sau whose là danh từ, không thêm tính từ sở hữu.',
      layout: 'cards',
      cards: [
        {
          title: 'Sai',
          accent: 'red',
          content: 'The student whose his English is good won the prize.',
        },
        {
          title: 'Đúng',
          accent: 'green',
          content: 'The student whose English is good won the prize.',
        },
        {
          title: 'Sai',
          accent: 'red',
          content: 'The country whose its language is English is popular.',
        },
        {
          title: 'Đúng',
          accent: 'green',
          content: 'The country whose language is English is popular.',
        },
      ],
    },
    {
      id: 's28',
      title: 'Where',
      subtitle: 'Where là trạng từ quan hệ chỉ nơi chốn.',
      layout: 'explain',
      accent: 'green',
      formula: 'Place + where + S + V + ...',
      bullets: [
        { content: 'Where thay cho in which / at which / on which.' },
        { content: 'Sau where là một mệnh đề đầy đủ.' },
        { content: 'Dùng với school, centre, country, classroom, website.' },
      ],
      examples: [
        'This is the school where I learn English.',
        'Singapore is a country where English is widely spoken.',
        'The website where I learn new words is useful.',
      ],
    },
    {
      id: 's29',
      title: 'When',
      subtitle: 'When là trạng từ quan hệ chỉ thời gian.',
      layout: 'explain',
      accent: 'blue',
      formula: 'Time + when + S + V + ...',
      bullets: [
        { content: 'When thay cho in which / on which / at which khi nói về thời gian.' },
        { content: 'Dùng với day, time, year, summer, Monday.' },
        { content: 'Sau when là một mệnh đề đầy đủ.' },
      ],
      examples: [
        'I remember the day when I first spoke English confidently.',
        'Summer is the time when many students join English courses.',
        'Monday is the day when our English club meets.',
      ],
    },
    {
      id: 's30',
      title: 'Why',
      subtitle: 'Why là trạng từ quan hệ chỉ lý do, thường đi sau reason.',
      layout: 'explain',
      accent: 'purple',
      formula: 'The reason + why + S + V + ...',
      bullets: [
        { content: 'Why thay cho for which.' },
        { content: 'Thường dùng sau the reason.' },
        { content: 'Sau why là một mệnh đề đầy đủ.' },
      ],
      examples: [
        'This is the reason why I learn English.',
        'I don’t know the reason why he stopped studying English.',
        'She explained the reason why English is important.',
      ],
    },
    {
      id: 's31',
      title: 'Which hay Where?',
      subtitle: 'Which thay cho danh từ; where thay cho ở nơi đó.',
      layout: 'cards',
      cards: [
        {
          title: 'Which',
          accent: 'green',
          content: 'The school which I visited was large.',
          example: 'Tôi đã tham quan ngôi trường đó.',
        },
        {
          title: 'Where',
          accent: 'blue',
          content: 'The school where I study English is large.',
          example: 'Tôi học tiếng Anh ở ngôi trường đó.',
        },
        {
          title: 'Mẹo chọn',
          accent: 'orange',
          content:
            'Nếu sau chỗ trống thiếu tân ngữ, dùng which. Nếu câu mang nghĩa ở đó, dùng where.',
        },
      ],
    },
    {
      id: 's32',
      title: 'Which hay When?',
      subtitle: 'Which thay cho danh từ thời gian; when thay cho vào thời điểm đó.',
      layout: 'cards',
      cards: [
        {
          title: 'When',
          accent: 'blue',
          content: 'I remember the day when I first joined the English club.',
        },
        {
          title: 'Which',
          accent: 'green',
          content: 'The day which we chose for the test was Friday.',
        },
        {
          title: 'Mẹo chọn',
          accent: 'orange',
          content:
            'Nếu nghĩa là vào ngày / năm đó, dùng when. Nếu danh từ là object của động từ, dùng which.',
        },
      ],
    },
    {
      id: 's33',
      title: 'Lỗi thường gặp',
      subtitle: 'Tránh dùng sai đại từ quan hệ hoặc lặp lại đại từ.',
      layout: 'cards',
      cards: [
        {
          title: 'Sai người / vật',
          accent: 'red',
          content: 'Sai: The student which speaks English well is my friend.',
          example: 'Đúng: The student who speaks English well is my friend.',
        },
        {
          title: 'Sai vật / người',
          accent: 'red',
          content: 'Sai: The book who I bought is useful.',
          example: 'Đúng: The book which I bought is useful.',
        },
        {
          title: 'Lặp đại từ',
          accent: 'orange',
          content: 'Sai: The book which I bought it is useful.',
          example: 'Đúng: The book which I bought is useful.',
        },
      ],
    },
    {
      id: 's34',
      title: 'Lưu ý với where / when / why',
      subtitle: 'Sau relative adverbs là một mệnh đề đầy đủ.',
      layout: 'cards',
      cards: [
        {
          title: 'Where',
          accent: 'green',
          content: 'This is the place where I practise English.',
        },
        {
          title: 'When',
          accent: 'blue',
          content: 'I remember the day when I first spoke to a foreigner.',
        },
        {
          title: 'Why',
          accent: 'purple',
          content: 'This is the reason why I like English.',
        },
        {
          title: 'No comma',
          accent: 'orange',
          content: 'The app which I use every day is helpful.',
        },
      ],
    },
    {
      id: 's35',
      title: 'Từ vựng: English and Languages',
      subtitle: 'Các từ về tiếng Anh và ngôn ngữ.',
      layout: 'cards',
      cards: [
        {
          title: 'Language types',
          accent: 'blue',
          content: 'language, mother tongue, second language, foreign language',
          example: 'Vietnamese is my mother tongue.',
        },
        {
          title: 'English status',
          accent: 'green',
          content: 'official language, global language, international language',
          example: 'English is an international language.',
        },
        {
          title: 'Language skills',
          accent: 'purple',
          content: 'accent, pronunciation, vocabulary, grammar, fluency',
          example: 'Good pronunciation helps communication.',
        },
      ],
    },
    {
      id: 's36',
      title: 'Từ vựng: Người học và nơi dùng tiếng Anh',
      subtitle: 'Dùng trong ví dụ với relative clauses.',
      layout: 'cards',
      cards: [
        {
          title: 'People',
          accent: 'blue',
          content: 'learner, speaker, native speaker, bilingual student, translator, interpreter',
          example: 'English learners need practice.',
        },
        {
          title: 'Countries',
          accent: 'green',
          content:
            'English-speaking country, the UK, the USA, Canada, Australia, New Zealand, Singapore',
          example: 'Singapore is a country where English is widely used.',
        },
        {
          title: 'Places',
          accent: 'purple',
          content: 'international school, language centre',
          example: 'This is the school where students use English every day.',
        },
      ],
    },
    {
      id: 's37',
      title: 'Từ vựng: Hoạt động học tiếng Anh',
      subtitle: 'Cụm động từ thường dùng với mệnh đề quan hệ.',
      layout: 'cards',
      cards: [
        {
          title: 'Practice',
          accent: 'blue',
          content: 'learn vocabulary, practise speaking, improve pronunciation',
          example: 'The app that helps me learn vocabulary is free.',
        },
        {
          title: 'Resources',
          accent: 'green',
          content: 'watch English videos, read English books, use a dictionary',
          example: 'The dictionary which I use is online.',
        },
        {
          title: 'Communication',
          accent: 'purple',
          content: 'join an English club, communicate with foreigners, take an English course',
          example: 'I joined an English club last year.',
        },
      ],
    },
    {
      id: 's38',
      title: 'Cấu trúc giao tiếp thường gặp',
      subtitle: 'Dùng relative clauses để miêu tả người, vật, nơi chốn, thời gian và lý do.',
      layout: 'cards',
      cards: [
        {
          title: 'Person + who',
          accent: 'blue',
          content: 'The student who speaks English fluently is my friend.',
        },
        {
          title: 'Thing + which / that',
          accent: 'green',
          content: 'The app that helps me learn vocabulary is free.',
        },
        {
          title: 'Place + where',
          accent: 'purple',
          content: 'This is the centre where I practise speaking English.',
        },
        {
          title: 'Reason + why',
          accent: 'orange',
          content: 'The reason why I learn English is to communicate with foreigners.',
        },
      ],
    },
    {
      id: 's39',
      title: 'Bài tập mẫu',
      subtitle: 'Chọn từ quan hệ hoặc sửa lỗi sai.',
      layout: 'practice',
      accent: 'green',
      sections: [
        {
          title: 'Bài 1',
          content: 'The student _____ won the English contest is in my class.',
          example: 'who / that',
        },
        {
          title: 'Bài 2',
          content: 'This is the language centre _____ I practise speaking English.',
          example: 'where',
        },
        {
          title: 'Bài 3',
          content: 'Sửa lỗi: The teacher whose his lessons are interesting is popular.',
          example: 'The teacher whose lessons are interesting is popular.',
        },
      ],
    },
    {
      id: 's40',
      title: 'Đáp án và tổng kết Unit 9',
      subtitle: 'English in the World',
      layout: 'practice',
      accent: 'purple',
      sections: [
        {
          title: 'Relative pronouns',
          content: 'who / whom / which / that / whose',
          example: 'The book which I borrowed from the library is useful.',
        },
        {
          title: 'Relative adverbs',
          content: 'where / when / why',
          example: 'I remember the year when I started learning English seriously.',
        },
        {
          title: 'Defining clause',
          content:
            'Không dùng dấu phẩy; có thể dùng that; có thể lược bỏ đại từ quan hệ khi làm tân ngữ.',
          example: 'The book I bought yesterday is useful.',
        },
      ],
    },
  ],
};

export default deck;
