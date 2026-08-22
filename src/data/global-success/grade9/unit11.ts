import { LessonDeck } from '../../../types';

const deck: LessonDeck = {
  id: 'gs-g9-u11-science-and-technology',
  curriculumFamily: 'global-success',
  grade: 9,
  unitNumber: 11,
  title: 'Grammar Grade 9 - Unit 11: Science and Technology',
  description:
    'Bài giảng Unit 11 Global Success 9 về suggest, advise, recommend + V-ing / that clause và từ vựng Science and Technology.',
  createdAt: '2026-05-18T00:00:00.000Z',
  slides: [
    {
      id: 's1',
      title: 'GRAMMAR GRADE 9',
      subtitle: 'UNIT 11: SCIENCE AND TECHNOLOGY',
      label: 'NỘI DUNG BÀI HỌC:',
      layout: 'outline',
      cards: [
        {
          title: 'SUGGEST / ADVISE / RECOMMEND + V-ING',
          subtitle: '(Đề xuất / khuyên / giới thiệu + V-ing)',
          accent: 'blue',
        },
        {
          title: 'SUGGEST / ADVISE / RECOMMEND + THAT CLAUSE',
          subtitle: '(Đề xuất / khuyên / giới thiệu + mệnh đề that)',
          accent: 'purple',
        },
        {
          title: 'SCIENCE AND TECHNOLOGY VOCABULARY',
          subtitle: '(Từ vựng khoa học và công nghệ)',
          accent: 'green',
        },
      ],
    },
    {
      id: 's2',
      title: 'Mục tiêu bài học',
      layout: 'objectives',
      bullets: [
        {
          content:
            'Dùng suggest, advise, recommend + V-ing để đề xuất hoặc khuyên làm một việc nói chung.',
        },
        { content: 'Dùng advise + object + to V khi muốn khuyên trực tiếp một người làm gì.' },
        {
          content:
            'Dùng suggest / advise / recommend + that clause để nêu lời đề xuất rõ ràng hơn.',
        },
        {
          content:
            'Tránh các lỗi thường gặp như suggest to V, suggest someone to V và should + V-ing.',
        },
      ],
    },
    {
      id: 's3',
      title: 'Phần 1',
      subtitle: 'Suggest / Advise / Recommend + V-ing',
      layout: 'section-cover',
      accent: 'blue',
    },
    {
      id: 's4',
      title: 'Ba động từ chính',
      subtitle: 'Dùng để đưa ra đề xuất, lời khuyên hoặc giới thiệu một việc nên làm.',
      layout: 'cards',
      cards: [
        {
          title: 'Suggest',
          accent: 'blue',
          content: 'Đề xuất / gợi ý một ý tưởng.',
          example: 'I suggest using tablets for online learning.',
        },
        {
          title: 'Advise',
          accent: 'green',
          content: 'Khuyên làm điều tốt, an toàn hoặc cần thiết.',
          example: 'Experts advise protecting personal information online.',
        },
        {
          title: 'Recommend',
          accent: 'purple',
          content: 'Giới thiệu / khuyên dùng vì thấy hữu ích hoặc phù hợp.',
          example: 'I recommend using this learning app.',
        },
      ],
    },
    {
      id: 's5',
      title: 'Suggest + V-ing',
      subtitle: 'Dùng suggest khi muốn đưa ra một đề xuất hoặc gợi ý.',
      layout: 'explain',
      accent: 'blue',
      formula: 'S + suggest + V-ing + ...',
      bullets: [
        { content: 'Sau suggest có thể dùng V-ing.' },
        { content: 'Cấu trúc này nói chung về một việc nên làm.' },
        { content: 'Không dùng suggest to V ngay sau suggest.' },
      ],
      examples: [
        'I suggest using e-readers instead of paper books.',
        'She suggests learning English with an online app.',
        'They suggested joining the technology fair.',
      ],
    },
    {
      id: 's6',
      title: 'Suggest trong chủ đề công nghệ',
      subtitle: 'Dùng để gợi ý cách học hoặc sử dụng công nghệ.',
      layout: 'cards',
      cards: [
        {
          title: 'AI tools',
          accent: 'blue',
          content: 'I suggest using AI tools carefully.',
        },
        {
          title: 'Robots',
          accent: 'purple',
          content: 'Our teacher suggests doing research on robots.',
        },
        {
          title: 'Laptop',
          accent: 'green',
          content: 'My brother suggested buying a new laptop for study.',
        },
        {
          title: 'Presentation',
          accent: 'orange',
          content: 'The students suggest creating a digital presentation.',
        },
      ],
    },
    {
      id: 's7',
      title: 'Advise + V-ing',
      subtitle: 'Dùng advise khi lời khuyên mang tính tốt, an toàn hoặc cần thiết.',
      layout: 'explain',
      accent: 'green',
      formula: 'S + advise + V-ing + ...',
      bullets: [
        { content: 'Advise + V-ing thường dùng cho lời khuyên chung.' },
        { content: 'Chủ ngữ thường là experts, doctors, teachers, parents.' },
        { content: 'Nội dung thường liên quan đến an toàn, sức khỏe hoặc thói quen tốt.' },
      ],
      examples: [
        'Experts advise protecting personal information online.',
        'Doctors advise taking breaks when using computers for a long time.',
        'Teachers advise checking online sources carefully.',
      ],
    },
    {
      id: 's8',
      title: 'Advise + object + to V',
      subtitle: 'Dùng khi muốn khuyên trực tiếp ai đó làm gì.',
      layout: 'explain',
      accent: 'green',
      formula: 'S + advise + someone + to + V',
      bullets: [
        { content: 'Sau object dùng to + động từ nguyên mẫu.' },
        { content: 'Cấu trúc này khác với advise + V-ing.' },
        { content: 'Có thể dùng ở hiện tại hoặc quá khứ: advise / advised.' },
      ],
      examples: [
        'The teacher advised us to use technology wisely.',
        'My parents advised me to spend less time on my phone.',
        'Experts advise users to change passwords regularly.',
      ],
    },
    {
      id: 's9',
      title: 'Advise: hai cách dùng',
      subtitle: 'Phân biệt lời khuyên chung và lời khuyên cho một người cụ thể.',
      layout: 'cards',
      cards: [
        {
          title: 'Advise + V-ing',
          accent: 'green',
          content: 'Khuyên làm việc gì nói chung.',
          example: 'Experts advise protecting data.',
        },
        {
          title: 'Advise + O + to V',
          accent: 'blue',
          content: 'Khuyên ai đó làm gì.',
          example: 'Experts advise users to protect data.',
        },
        {
          title: 'Ghi nhớ',
          accent: 'orange',
          content: 'Object là người nhận lời khuyên: me, us, students, users.',
          example: 'The doctor advised him to rest his eyes.',
        },
      ],
    },
    {
      id: 's10',
      title: 'Recommend + V-ing',
      subtitle: 'Dùng recommend khi giới thiệu hoặc khuyên dùng điều hữu ích.',
      layout: 'explain',
      accent: 'purple',
      formula: 'S + recommend + V-ing + ...',
      bullets: [
        { content: 'Recommend thường dùng khi người nói cho rằng việc đó tốt hoặc phù hợp.' },
        { content: 'Có thể dùng với app, website, e-book, video, software hoặc thiết bị.' },
        { content: 'Sau recommend có thể dùng V-ing.' },
      ],
      examples: [
        'I recommend using this learning app.',
        'The teacher recommends reading e-books.',
        'Experts recommend installing antivirus software.',
      ],
    },
    {
      id: 's11',
      title: 'Recommend trong chủ đề công nghệ',
      subtitle: 'Dùng để giới thiệu công cụ, thiết bị hoặc cách học.',
      layout: 'cards',
      cards: [
        {
          title: 'Renewable technology',
          accent: 'green',
          content: 'Scientists recommend using renewable technology.',
        },
        {
          title: 'Tablets',
          accent: 'blue',
          content: 'The school recommends using tablets in class.',
        },
        {
          title: 'Robot vacuum cleaner',
          accent: 'purple',
          content: 'I recommend trying this robot vacuum cleaner.',
        },
        {
          title: 'Coding',
          accent: 'orange',
          content: 'The website recommends learning coding step by step.',
        },
      ],
    },
    {
      id: 's12',
      title: 'So sánh V-ing',
      subtitle: 'Ba động từ giống nhau về cấu trúc nhưng khác sắc thái.',
      layout: 'cards',
      cards: [
        {
          title: 'Suggest',
          accent: 'blue',
          content: 'Gợi ý nhẹ nhàng.',
          example: 'I suggest using tablets.',
        },
        {
          title: 'Advise',
          accent: 'green',
          content: 'Khuyên nghiêm túc hơn.',
          example: 'Experts advise protecting data.',
        },
        {
          title: 'Recommend',
          accent: 'purple',
          content: 'Giới thiệu / khuyên dùng.',
          example: 'I recommend using this app.',
        },
      ],
    },
    {
      id: 's13',
      title: 'Lỗi cần tránh với V-ing',
      subtitle: 'Các lỗi này rất dễ gặp trong bài viết.',
      layout: 'cards',
      cards: [
        {
          title: 'Suggest to V',
          accent: 'red',
          content: 'Sai: I suggest to use tablets.',
          example: 'Đúng: I suggest using tablets.',
        },
        {
          title: 'Suggest someone to V',
          accent: 'red',
          content: 'Sai: The teacher suggested us to use tablets.',
          example: 'Đúng: The teacher suggested that we use tablets.',
        },
        {
          title: 'Advise + object + to V',
          accent: 'green',
          content: 'Advise có thể dùng với someone to V.',
          example: 'The teacher advised us to use tablets carefully.',
        },
      ],
    },
    {
      id: 's14',
      title: 'Ví dụ minh họa V-ing',
      subtitle: 'Xác định động từ chính và dạng V-ing theo sau.',
      layout: 'cards',
      cards: [
        {
          title: 'Suggest',
          accent: 'blue',
          content: 'I suggest using online dictionaries.',
          example: 'Use chuyển thành using sau suggest.',
        },
        {
          title: 'Advise',
          accent: 'green',
          content: 'Experts advise protecting personal data.',
          example: 'Protect chuyển thành protecting sau advise.',
        },
        {
          title: 'Recommend',
          accent: 'purple',
          content: 'Our teacher recommends watching science videos.',
          example: 'Watch chuyển thành watching sau recommend.',
        },
      ],
    },
    {
      id: 's15',
      title: 'Luyện tập: V-ing',
      subtitle: 'Chọn dạng đúng của động từ.',
      layout: 'practice',
      accent: 'blue',
      sections: [
        {
          title: 'Câu 1',
          content: 'I suggest _____ e-readers for literature lessons. (use)',
          example: 'using',
        },
        {
          title: 'Câu 2',
          content: 'Experts advise _____ strong passwords. (create)',
          example: 'creating',
        },
        {
          title: 'Câu 3',
          content: 'The teacher recommends _____ science videos at home. (watch)',
          example: 'watching',
        },
      ],
    },
    {
      id: 's16',
      title: 'Phần 2',
      subtitle: 'Suggest / Advise / Recommend + That Clause',
      layout: 'section-cover',
      accent: 'purple',
    },
    {
      id: 's17',
      title: 'That clause là gì?',
      subtitle: 'Dùng để nêu rõ ai nên làm gì theo lời đề xuất hoặc lời khuyên.',
      layout: 'explain',
      accent: 'purple',
      formula: 'S + suggest / advise / recommend + that + S + should + V',
      bullets: [
        { content: 'That clause giúp câu rõ hơn vì có chủ ngữ riêng sau that.' },
        { content: 'Sau should dùng động từ nguyên mẫu.' },
        { content: 'Có thể bỏ should trong nhiều câu trang trọng.' },
      ],
      examples: [
        'I suggest that students should use technology wisely.',
        'Experts advise that people should protect their personal data.',
        'The teacher recommended that we use online dictionaries.',
      ],
    },
    {
      id: 's18',
      title: 'Suggest + that clause',
      subtitle: 'Dùng để đề xuất ai đó nên làm gì.',
      layout: 'explain',
      accent: 'blue',
      formula: 'S + suggest + that + S + should + V / V nguyên mẫu',
      bullets: [
        { content: 'Có thể dùng should + V.' },
        { content: 'Có thể bỏ should và giữ động từ nguyên mẫu.' },
        { content: 'Không dùng suggest someone to V.' },
      ],
      examples: [
        'I suggest that we should use tablets for learning.',
        'She suggested that students should join the technology fair.',
        'The teacher suggests that we check information carefully.',
      ],
    },
    {
      id: 's19',
      title: 'Suggest + that trong chủ đề công nghệ',
      subtitle: 'Đề xuất hoạt động khoa học hoặc cách học bằng công nghệ.',
      layout: 'cards',
      cards: [
        {
          title: 'Robot model',
          accent: 'blue',
          content: 'I suggest that our class should make a robot model.',
        },
        {
          title: 'Digital presentation',
          accent: 'purple',
          content: 'The teacher suggested that we should prepare a digital presentation.',
        },
        {
          title: 'E-books',
          accent: 'green',
          content: 'They suggest that students use e-books instead of paper books.',
        },
        {
          title: 'Coding',
          accent: 'orange',
          content: 'My brother suggested that I learn coding online.',
        },
      ],
    },
    {
      id: 's20',
      title: 'Advise + that clause',
      subtitle: 'Dùng để đưa ra lời khuyên rõ ràng về việc ai nên làm gì.',
      layout: 'explain',
      accent: 'green',
      formula: 'S + advise + that + S + should + V / V nguyên mẫu',
      bullets: [
        { content: 'Dùng khi lời khuyên có chủ ngữ cụ thể trong mệnh đề that.' },
        { content: 'Phù hợp với lời khuyên từ experts, doctors, teachers, parents.' },
        {
          content:
            'Nội dung thường liên quan đến an toàn công nghệ hoặc sức khỏe khi dùng thiết bị.',
        },
      ],
      examples: [
        'Experts advise that users should create strong passwords.',
        'Doctors advise that students should take breaks from screens.',
        'Teachers advise that students check online sources carefully.',
      ],
    },
    {
      id: 's21',
      title: 'Advise + that trong chủ đề công nghệ',
      subtitle: 'Nêu lời khuyên cụ thể cho users, students hoặc people.',
      layout: 'cards',
      cards: [
        {
          title: 'Personal information',
          accent: 'green',
          content: 'Experts advise that people should not share personal information online.',
        },
        {
          title: 'AI tools',
          accent: 'blue',
          content: 'The teacher advised that we should use AI tools responsibly.',
        },
        {
          title: 'Eyes',
          accent: 'purple',
          content: 'The doctor advised that students should rest their eyes regularly.',
        },
        {
          title: 'Environment',
          accent: 'orange',
          content:
            'Scientists advise that people should use technology to protect the environment.',
        },
      ],
    },
    {
      id: 's22',
      title: 'Recommend + that clause',
      subtitle: 'Dùng để khuyến nghị ai đó nên dùng hoặc làm điều hữu ích.',
      layout: 'explain',
      accent: 'purple',
      formula: 'S + recommend + that + S + should + V / V nguyên mẫu',
      bullets: [
        { content: 'Recommend nhấn mạnh điều được giới thiệu là tốt hoặc phù hợp.' },
        { content: 'Có thể dùng should hoặc bỏ should.' },
        { content: 'Thường gặp với app, website, software, e-books hoặc coding skills.' },
      ],
      examples: [
        'I recommend that students should use this science website.',
        'The teacher recommended that we should read more e-books.',
        'Experts recommend that users update their software regularly.',
      ],
    },
    {
      id: 's23',
      title: 'Recommend + that trong chủ đề công nghệ',
      subtitle: 'Giới thiệu công cụ hoặc hoạt động học tập cụ thể.',
      layout: 'cards',
      cards: [
        {
          title: 'Learning app',
          accent: 'purple',
          content: 'I recommend that you try this learning app.',
        },
        {
          title: 'Documentary',
          accent: 'blue',
          content: 'Our teacher recommended that we watch a documentary about robots.',
        },
        {
          title: 'Antivirus software',
          accent: 'green',
          content: 'The IT expert recommended that we install antivirus software.',
        },
        {
          title: 'Coding skills',
          accent: 'orange',
          content: 'The school recommends that students learn basic coding skills.',
        },
      ],
    },
    {
      id: 's24',
      title: 'Bảng công thức chi tiết',
      subtitle: 'Nắm nhanh các cấu trúc chính của Unit 11.',
      layout: 'cards',
      cards: [
        {
          title: 'Suggest',
          accent: 'blue',
          content: 'suggest + V-ing / suggest that + S + should + V',
          example: 'I suggest using tablets. / I suggest that we should use tablets.',
        },
        {
          title: 'Advise',
          accent: 'green',
          content: 'advise + V-ing / advise + O + to V / advise that + S + should + V',
          example: 'He advised me to use strong passwords.',
        },
        {
          title: 'Recommend',
          accent: 'purple',
          content: 'recommend + V-ing / recommend that + S + should + V',
          example: 'I recommend that you should use this app.',
        },
      ],
    },
    {
      id: 's25',
      title: 'Có thể bỏ should',
      subtitle: 'Trong that clause, should có thể xuất hiện hoặc được lược bỏ.',
      layout: 'cards',
      cards: [
        {
          title: 'Có should',
          accent: 'purple',
          content: 'I suggest that we should use tablets.',
        },
        {
          title: 'Không có should',
          accent: 'blue',
          content: 'I suggest that we use tablets.',
        },
        {
          title: 'Giữ động từ nguyên mẫu',
          accent: 'green',
          content: 'Experts recommend that students learn coding.',
          example:
            'Không viết learns dù students là số nhiều hoặc he/she là số ít sau cấu trúc này.',
        },
      ],
    },
    {
      id: 's26',
      title: 'Chuyển đổi V-ing và That clause',
      subtitle: 'Hai cách viết có thể truyền đạt cùng một ý.',
      layout: 'cards',
      cards: [
        {
          title: 'Suggest',
          accent: 'blue',
          content: 'I suggest using tablets in class.',
          example: 'I suggest that we should use tablets in class.',
        },
        {
          title: 'Advise',
          accent: 'green',
          content: 'Experts advise protecting personal data.',
          example: 'Experts advise that users should protect personal data.',
        },
        {
          title: 'Recommend',
          accent: 'purple',
          content: 'The teacher recommends watching science videos.',
          example: 'The teacher recommends that students should watch science videos.',
        },
      ],
    },
    {
      id: 's27',
      title: 'Lỗi cần tránh với That clause',
      subtitle: 'Sau should luôn dùng động từ nguyên mẫu.',
      layout: 'cards',
      cards: [
        {
          title: 'Should + V-ing',
          accent: 'red',
          content: 'Sai: I suggest that we should using tablets.',
          example: 'Đúng: I suggest that we should use tablets.',
        },
        {
          title: 'Should + V-s/es',
          accent: 'red',
          content: 'Sai: The teacher recommends that he should uses the app.',
          example: 'Đúng: The teacher recommends that he should use the app.',
        },
        {
          title: 'Bỏ should',
          accent: 'green',
          content: 'Khi bỏ should, động từ vẫn giữ dạng nguyên mẫu.',
          example: 'Experts recommend that students learn coding.',
        },
      ],
    },
    {
      id: 's28',
      title: 'Advice và Advise',
      subtitle: 'Hai từ dễ nhầm nhưng khác loại từ.',
      layout: 'cards',
      cards: [
        {
          title: 'Advice',
          accent: 'orange',
          content: 'Danh từ: lời khuyên.',
          example: 'This is useful advice.',
        },
        {
          title: 'Advise',
          accent: 'green',
          content: 'Động từ: khuyên.',
          example: 'Experts advise using strong passwords.',
        },
        {
          title: 'Lỗi thường gặp',
          accent: 'red',
          content: 'Sai: My teacher advice me to study online.',
          example: 'Đúng: My teacher advised me to study online.',
        },
      ],
    },
    {
      id: 's29',
      title: 'Ví dụ minh họa That clause',
      subtitle: 'Phân tích dạng động từ trong mệnh đề that.',
      layout: 'cards',
      cards: [
        {
          title: 'Suggest',
          accent: 'blue',
          content: 'I suggest that students should use e-books.',
          example: 'Sau should dùng use.',
        },
        {
          title: 'Advise',
          accent: 'green',
          content: 'Experts advise that users should update their software regularly.',
          example: 'Lời khuyên về an toàn công nghệ.',
        },
        {
          title: 'Recommend',
          accent: 'purple',
          content: 'The teacher recommended that we watch a video about AI.',
          example: 'Bỏ should nhưng watch vẫn ở dạng nguyên mẫu.',
        },
      ],
    },
    {
      id: 's30',
      title: 'Luyện tập: That clause',
      subtitle: 'Hoàn thành câu bằng dạng đúng.',
      layout: 'practice',
      accent: 'purple',
      sections: [
        {
          title: 'Câu 1',
          content: 'I suggest that our class should _____ a robot model. (make)',
          example: 'make',
        },
        {
          title: 'Câu 2',
          content: 'Experts recommend that users _____ their software regularly. (update)',
          example: 'update',
        },
        {
          title: 'Câu 3',
          content: 'The teacher advised that we should _____ AI tools responsibly. (use)',
          example: 'use',
        },
      ],
    },
    {
      id: 's31',
      title: 'Phần 3',
      subtitle: 'Science and Technology Vocabulary',
      layout: 'section-cover',
      accent: 'green',
    },
    {
      id: 's32',
      title: 'Từ vựng: Thiết bị công nghệ',
      subtitle: 'Các thiết bị thường gặp trong học tập và đời sống.',
      layout: 'cards',
      cards: [
        {
          title: 'Learning devices',
          accent: 'blue',
          content: 'tablet, laptop, computer, e-reader',
          example: 'I suggest using tablets for learning.',
        },
        {
          title: 'Smart devices',
          accent: 'green',
          content: 'smartphone, smart device, robot',
          example: 'Smart devices make life easier.',
        },
        {
          title: 'Digital tools',
          accent: 'purple',
          content: 'digital camera, app, software',
          example: 'A digital camera takes clear photos.',
        },
      ],
    },
    {
      id: 's33',
      title: 'Từ vựng: Công nghệ hiện đại',
      subtitle: 'Các khái niệm công nghệ trong Unit 11.',
      layout: 'cards',
      cards: [
        {
          title: 'AI and VR',
          accent: 'purple',
          content: 'artificial intelligence / AI, virtual reality / VR',
          example: 'AI can answer questions quickly.',
        },
        {
          title: 'Learning technology',
          accent: 'blue',
          content: 'online learning, e-book, coding, application / app',
          example: 'Online learning is popular now.',
        },
        {
          title: 'Safety software',
          accent: 'green',
          content: 'software, antivirus software',
          example: 'Experts recommend installing antivirus software.',
        },
      ],
    },
    {
      id: 's34',
      title: 'Từ vựng: Hoạt động với công nghệ',
      subtitle: 'Cụm động từ dùng với suggest, advise, recommend.',
      layout: 'cards',
      cards: [
        {
          title: 'Research',
          accent: 'blue',
          content: 'search for information, check information, create a presentation',
          example: 'Teachers advise checking information carefully.',
        },
        {
          title: 'Security',
          accent: 'green',
          content: 'update software, protect data, install an app',
          example: 'Experts advise protecting personal data.',
        },
        {
          title: 'Learning',
          accent: 'purple',
          content: 'join a technology fair, learn coding, use technology',
          example: 'I suggest joining the technology fair.',
        },
        {
          title: 'Screen habits',
          accent: 'orange',
          content: 'limit screen time',
          example: 'Parents advise limiting screen time.',
        },
      ],
    },
    {
      id: 's35',
      title: 'Từ vựng: Tính từ miêu tả công nghệ',
      subtitle: 'Dùng để nhận xét thiết bị, ứng dụng hoặc phát minh.',
      layout: 'cards',
      cards: [
        {
          title: 'Useful technology',
          accent: 'green',
          content: 'useful, convenient, smart, advanced',
          example: 'This app is useful.',
        },
        {
          title: 'Modern technology',
          accent: 'blue',
          content: 'modern, digital, automatic, creative',
          example: 'Modern technology is changing education.',
        },
        {
          title: 'Safety',
          accent: 'orange',
          content: 'safe, dangerous',
          example: 'Sharing personal data online can be dangerous.',
        },
      ],
    },
    {
      id: 's36',
      title: 'Cấu trúc giao tiếp thường gặp',
      subtitle: 'Dùng để đề xuất hoặc khuyên về công nghệ.',
      layout: 'cards',
      cards: [
        {
          title: 'Đề xuất',
          accent: 'blue',
          content: 'I suggest + V-ing.',
          example: 'I suggest learning coding online.',
        },
        {
          title: 'Lời khuyên',
          accent: 'green',
          content: 'Experts advise + V-ing.',
          example: 'Experts advise using strong passwords.',
        },
        {
          title: 'Giới thiệu',
          accent: 'purple',
          content: 'I recommend + V-ing.',
          example: 'I recommend reading e-books.',
        },
        {
          title: 'That clause',
          accent: 'orange',
          content: 'S + suggest / advise / recommend + that + S + should + V.',
          example: 'I suggest that we should use technology wisely.',
        },
      ],
    },
    {
      id: 's37',
      title: 'Bài viết mẫu ngắn',
      subtitle: 'Kết hợp cấu trúc ngữ pháp và từ vựng công nghệ.',
      layout: 'explain',
      accent: 'purple',
      formula: 'Opinion + recommendation + reason',
      bullets: [
        { content: 'I recommend using e-books because they are convenient.' },
        { content: 'Teachers advise that students should check information carefully.' },
        { content: 'I suggest that our class make digital presentations more often.' },
      ],
      examples: [
        'Technology is useful for learning. I recommend using e-books because they are convenient. However, experts advise protecting personal data online.',
      ],
    },
    {
      id: 's38',
      title: 'Sửa lỗi tổng hợp',
      subtitle: 'Tìm lỗi và viết lại câu đúng.',
      layout: 'practice',
      accent: 'red',
      sections: [
        {
          title: 'Lỗi 1',
          content: 'I suggest to use AI tools carefully.',
          example: 'I suggest using AI tools carefully.',
        },
        {
          title: 'Lỗi 2',
          content: 'The teacher suggested us to check online sources.',
          example: 'The teacher suggested that we check online sources.',
        },
        {
          title: 'Lỗi 3',
          content: 'Experts advise that users should protecting data.',
          example: 'Experts advise that users should protect data.',
        },
      ],
    },
    {
      id: 's39',
      title: 'Viết lại câu',
      subtitle: 'Chuyển đổi giữa V-ing và that clause.',
      layout: 'practice',
      accent: 'blue',
      sections: [
        {
          title: 'Câu 1',
          content: 'I suggest using tablets in class.',
          example: 'I suggest that we should use tablets in class.',
        },
        {
          title: 'Câu 2',
          content: 'Experts advise protecting personal data.',
          example: 'Experts advise that users should protect personal data.',
        },
        {
          title: 'Câu 3',
          content: 'The teacher recommends watching science videos.',
          example: 'The teacher recommends that students should watch science videos.',
        },
      ],
    },
    {
      id: 's40',
      title: 'Tổng kết Unit 11',
      subtitle: 'Science and Technology',
      layout: 'practice',
      accent: 'green',
      sections: [
        {
          title: 'V-ing',
          content: 'suggest / advise / recommend + V-ing',
          example: 'I suggest using tablets.',
        },
        {
          title: 'Object + to V',
          content: 'advise + someone + to V',
          example: 'The teacher advised us to use technology wisely.',
        },
        {
          title: 'That clause',
          content: 'suggest / advise / recommend + that + S + should + V',
          example: 'Experts recommend that students should learn coding.',
        },
      ],
    },
  ],
};

export default deck;
