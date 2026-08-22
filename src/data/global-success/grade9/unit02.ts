import { LessonDeck } from '../../../types';

const deck: LessonDeck = {
  id: 'gs-g9-u2-city-life',
  curriculumFamily: 'global-success',
  grade: 9,
  unitNumber: 2,
  title: 'Grammar Grade 9 - Unit 2: City Life',
  description:
    'Bài giảng Unit 2 Global Success 9 về double comparatives, phrasal verbs và từ vựng City Life.',
  createdAt: '2026-05-18T00:00:00.000Z',
  slides: [
    {
      id: 's1',
      title: 'GRAMMAR GRADE 9',
      subtitle: 'UNIT 2: CITY LIFE',
      label: 'NỘI DUNG BÀI HỌC:',
      layout: 'outline',
      cards: [
        {
          title: 'DOUBLE COMPARATIVES',
          subtitle: '(So sánh kép)',
          accent: 'blue',
        },
        {
          title: 'PHRASAL VERBS',
          subtitle: '(Cụm động từ)',
          accent: 'green',
        },
        {
          title: 'CITY LIFE VOCABULARY',
          subtitle: '(Từ vựng cuộc sống thành thị)',
          accent: 'orange',
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
            'Dùng cấu trúc double comparatives để nói “càng..., càng...” trong chủ đề City Life.',
        },
        {
          content:
            'Phân biệt dạng so sánh hơn của tính từ ngắn, tính từ dài, trạng từ ngắn và trạng từ dài.',
        },
        { content: 'Dùng đúng the more / the less / the fewer để nói sự thay đổi tăng hoặc giảm.' },
        {
          content:
            'Sử dụng phrasal verbs như get around, carry out, cut down on, hang out with, put up with.',
        },
      ],
    },
    {
      id: 's3',
      title: 'Phần 1',
      subtitle: 'Double Comparatives',
      layout: 'section-cover',
      accent: 'blue',
    },
    {
      id: 's4',
      title: 'Double comparatives là gì?',
      subtitle: 'Cấu trúc so sánh kép diễn tả hai sự thay đổi xảy ra cùng nhau.',
      layout: 'explain',
      accent: 'blue',
      formula: 'The + comparative + S + V, the + comparative + S + V.',
      bullets: [
        { content: 'Nghĩa tiếng Việt thường là “Càng..., càng...”.' },
        { content: 'Hai vế đều bắt đầu bằng the.' },
        {
          content:
            'Dùng nhiều để nói về giao thông, dân số, giá cả, ô nhiễm và tiện ích thành phố.',
        },
      ],
      examples: [
        'The bigger the city is, the more crowded it becomes.',
        'The more people use public transport, the less traffic there is.',
        'The faster cities develop, the more services people need.',
      ],
    },
    {
      id: 's5',
      title: 'Công thức chung',
      subtitle: 'Mỗi vế có một dạng so sánh hơn.',
      layout: 'cards',
      cards: [
        {
          title: 'Mẫu cơ bản',
          accent: 'blue',
          content: 'The + comparative + S + V, the + comparative + S + V.',
          example: 'The faster we walk, the earlier we arrive.',
        },
        {
          title: 'City life',
          accent: 'green',
          content: 'The more crowded the city is, the more stressful life becomes.',
        },
        {
          title: 'Cost of living',
          accent: 'orange',
          content: 'The more modern the city becomes, the more expensive life is.',
        },
      ],
    },
    {
      id: 's6',
      title: 'Tính từ ngắn',
      subtitle: 'Tính từ ngắn thường thêm -er trong so sánh hơn.',
      layout: 'explain',
      accent: 'blue',
      formula: 'The + short adjective-er + S + V, the + comparative + S + V.',
      bullets: [
        { content: 'big -> bigger, noisy -> noisier, close -> closer, high -> higher.' },
        { content: 'Có thể kết hợp một vế tính từ ngắn với một vế more + adjective.' },
        { content: 'Không dùng more với tính từ ngắn đã thêm -er.' },
      ],
      examples: [
        'The bigger the city is, the noisier it becomes.',
        'The older the buildings are, the more historic the area looks.',
        'The closer we live to downtown, the higher the rent is.',
      ],
    },
    {
      id: 's7',
      title: 'Tính từ dài',
      subtitle: 'Tính từ dài dùng more + adjective.',
      layout: 'explain',
      accent: 'green',
      formula: 'The more + long adjective + S + V, the more + long adjective + S + V.',
      bullets: [
        { content: 'modern, convenient, expensive, attractive thường dùng với more.' },
        { content: 'Vế sau có thể dùng more, less, harder, higher tùy nghĩa.' },
        { content: 'Dùng để nói mức độ tiện lợi, hiện đại, đắt đỏ hoặc hấp dẫn.' },
      ],
      examples: [
        'The more convenient public transport is, the more popular it becomes.',
        'The more expensive the city is, the harder life becomes for workers.',
        'The more modern the buildings are, the more attractive the city looks.',
      ],
    },
    {
      id: 's8',
      title: 'Trạng từ ngắn',
      subtitle: 'Trạng từ ngắn như fast, early, hard có thể thêm -er.',
      layout: 'cards',
      cards: [
        {
          title: 'Fast',
          accent: 'blue',
          content: 'The faster people travel, the more time they save.',
        },
        {
          title: 'Early',
          accent: 'green',
          content: 'The earlier we leave home, the less traffic we meet.',
        },
        {
          title: 'Hard',
          accent: 'orange',
          content: 'The harder the city works on transport, the better life becomes.',
        },
      ],
    },
    {
      id: 's9',
      title: 'Trạng từ dài',
      subtitle: 'Trạng từ dài thường dùng more + adverb.',
      layout: 'cards',
      cards: [
        {
          title: 'Carefully',
          accent: 'blue',
          content: 'The more carefully drivers drive, the safer the roads become.',
        },
        {
          title: 'Efficiently',
          accent: 'green',
          content: 'The more efficiently the metro runs, the more people use it.',
        },
        {
          title: 'Quickly',
          accent: 'orange',
          content: 'The more quickly the city grows, the more houses people need.',
        },
      ],
    },
    {
      id: 's10',
      title: 'The more..., the more...',
      subtitle: 'Dùng khi cả hai sự việc cùng tăng lên.',
      layout: 'cards',
      cards: [
        {
          title: 'Population',
          accent: 'blue',
          content: 'The more people move to the city, the more crowded it becomes.',
        },
        {
          title: 'Vehicles',
          accent: 'green',
          content: 'The more vehicles there are, the more polluted the air becomes.',
        },
        {
          title: 'Amenities',
          accent: 'orange',
          content: 'The more public amenities a city has, the more attractive it is.',
        },
      ],
    },
    {
      id: 's11',
      title: 'The more..., the less...',
      subtitle: 'Dùng khi một điều tăng lên nhưng điều khác giảm xuống.',
      layout: 'cards',
      cards: [
        {
          title: 'Buses',
          accent: 'blue',
          content: 'The more people use buses, the less traffic there is.',
        },
        {
          title: 'Trees',
          accent: 'green',
          content: 'The more trees we plant, the less polluted the air becomes.',
        },
        {
          title: 'City planning',
          accent: 'orange',
          content: 'The more carefully people plan cities, the fewer problems they have.',
        },
      ],
    },
    {
      id: 's12',
      title: 'The less..., the more...',
      subtitle: 'Dùng khi một điều giảm thì điều khác tăng.',
      layout: 'cards',
      cards: [
        {
          title: 'Green space',
          accent: 'green',
          content: 'The less green space a city has, the more stressful life becomes.',
        },
        {
          title: 'Public transport',
          accent: 'blue',
          content: 'The less reliable public transport is, the more people use private vehicles.',
        },
        {
          title: 'Outdoor time',
          accent: 'orange',
          content: 'The less time people spend outside, the more tired they may feel.',
        },
      ],
    },
    {
      id: 's13',
      title: 'Quy tắc so sánh hơn',
      subtitle: 'Chọn đúng dạng comparative trước khi đưa vào cấu trúc kép.',
      layout: 'cards',
      cards: [
        {
          title: 'Short adjective',
          accent: 'blue',
          content: 'adj + er',
          example: 'fast -> faster',
        },
        {
          title: 'Long adjective',
          accent: 'green',
          content: 'more + adjective',
          example: 'modern -> more modern',
        },
        {
          title: 'Short adverb',
          accent: 'orange',
          content: 'adv + er',
          example: 'early -> earlier',
        },
        {
          title: 'Irregular',
          accent: 'purple',
          content: 'đổi dạng đặc biệt',
          example: 'good / well -> better; bad / badly -> worse',
        },
      ],
    },
    {
      id: 's14',
      title: 'Giao thông thành phố',
      subtitle: 'Dùng double comparatives để nói về traffic jams và public transport.',
      layout: 'cards',
      cards: [
        {
          title: 'Vehicles',
          accent: 'blue',
          content: 'The more vehicles there are, the worse traffic jams become.',
        },
        {
          title: 'Metro',
          accent: 'green',
          content: 'The better the metro system is, the more people use it.',
        },
        {
          title: 'Rush hour',
          accent: 'orange',
          content: 'The earlier people leave home, the less traffic they meet.',
        },
      ],
    },
    {
      id: 's15',
      title: 'Dân số và đô thị',
      subtitle: 'Dùng để nói về sự phát triển và nhu cầu nhà ở, dịch vụ.',
      layout: 'cards',
      cards: [
        {
          title: 'Crowded city',
          accent: 'blue',
          content: 'The bigger the city is, the more crowded it becomes.',
        },
        {
          title: 'Housing',
          accent: 'green',
          content: 'The more people move to the city, the more houses are needed.',
        },
        {
          title: 'Services',
          accent: 'orange',
          content: 'The more populous a city is, the more public services it needs.',
        },
      ],
    },
    {
      id: 's16',
      title: 'Chi phí sống',
      subtitle: 'Dùng để nói về tiền thuê nhà, giá nhà và cost of living.',
      layout: 'cards',
      cards: [
        {
          title: 'Downtown',
          accent: 'blue',
          content: 'The closer an apartment is to downtown, the more expensive it is.',
        },
        {
          title: 'Modern city',
          accent: 'green',
          content: 'The more modern the city becomes, the higher the cost of living is.',
        },
        {
          title: 'Popular area',
          accent: 'orange',
          content: 'The more popular an area is, the more expensive houses become.',
        },
      ],
    },
    {
      id: 's17',
      title: 'Chất lượng cuộc sống',
      subtitle: 'Dùng để nói về tiện ích, sức khỏe và không gian xanh.',
      layout: 'cards',
      cards: [
        {
          title: 'Amenities',
          accent: 'blue',
          content: 'The more public amenities there are, the more comfortable life becomes.',
        },
        {
          title: 'Clean city',
          accent: 'green',
          content: 'The cleaner the city is, the healthier people are.',
        },
        {
          title: 'Green spaces',
          accent: 'orange',
          content: 'The more green spaces a city has, the more relaxing it feels.',
        },
      ],
    },
    {
      id: 's18',
      title: 'Lỗi cần tránh',
      subtitle: 'Double comparatives cần đúng the và đúng dạng so sánh hơn.',
      layout: 'cards',
      cards: [
        {
          title: 'Thiếu the',
          accent: 'red',
          content: 'Sai: More crowded the city is, more stressful life becomes.',
          example: 'Đúng: The more crowded the city is, the more stressful life becomes.',
        },
        {
          title: 'Sai dạng comparative',
          accent: 'red',
          content: 'Sai: The more fast the bus is, the more convenient it is.',
          example: 'Đúng: The faster the bus is, the more convenient it is.',
        },
        {
          title: 'More + adj-er',
          accent: 'red',
          content: 'Sai: The more bigger the city is, the more crowded it becomes.',
          example: 'Đúng: The bigger the city is, the more crowded it becomes.',
        },
      ],
    },
    {
      id: 's19',
      title: 'Ví dụ phân tích',
      subtitle: 'Xác định hai sự thay đổi trong câu.',
      layout: 'cards',
      cards: [
        {
          title: 'City size',
          accent: 'blue',
          content: 'The bigger the city is, the more crowded it becomes.',
          example: 'Thành phố lớn hơn -> đông đúc hơn.',
        },
        {
          title: 'Public transport',
          accent: 'green',
          content: 'The more people use public transport, the less traffic there is.',
          example: 'Nhiều người dùng phương tiện công cộng hơn -> ít kẹt xe hơn.',
        },
        {
          title: 'Rent',
          accent: 'orange',
          content: 'The closer you live to the city centre, the higher the rent is.',
          example: 'Gần trung tâm hơn -> tiền thuê cao hơn.',
        },
      ],
    },
    {
      id: 's20',
      title: 'Luyện tập: Double comparatives',
      subtitle: 'Hoàn thành câu bằng dạng so sánh kép.',
      layout: 'practice',
      accent: 'blue',
      sections: [
        {
          title: 'Câu 1',
          content: 'The _____ the city is, the more crowded it becomes. (big)',
          example: 'bigger',
        },
        {
          title: 'Câu 2',
          content: 'The more people use buses, the _____ traffic there is. (little)',
          example: 'less',
        },
        {
          title: 'Câu 3',
          content: 'The _____ public transport is, the more people use it. (good)',
          example: 'better',
        },
      ],
    },
    {
      id: 's21',
      title: 'Phần 2',
      subtitle: 'Phrasal Verbs',
      layout: 'section-cover',
      accent: 'green',
    },
    {
      id: 's22',
      title: 'Phrasal verbs là gì?',
      subtitle: 'Cụm động từ được tạo bởi verb + particle.',
      layout: 'explain',
      accent: 'green',
      formula: 'Verb + particle',
      bullets: [
        { content: 'Particle có thể là up, down, around, out, with, on, off...' },
        { content: 'Nghĩa của phrasal verb có thể khác với nghĩa của từng từ riêng lẻ.' },
        {
          content:
            'Trong City Life, phrasal verbs thường nói về di chuyển, dự án, giải trí và vấn đề đô thị.',
        },
      ],
      examples: [
        'I usually get around the city by bus.',
        'The city is carrying out a project to improve public transport.',
        'We often hang out with friends at the shopping mall.',
      ],
    },
    {
      id: 's23',
      title: 'Không có tân ngữ',
      subtitle: 'Một số phrasal verbs có thể đứng một mình.',
      layout: 'cards',
      cards: [
        {
          title: 'break down',
          accent: 'red',
          content: 'The bus broke down.',
        },
        {
          title: 'move in',
          accent: 'blue',
          content: 'Many people moved in last year.',
        },
        {
          title: 'grow up',
          accent: 'green',
          content: 'The city has grown up quickly.',
        },
      ],
    },
    {
      id: 's24',
      title: 'Có tân ngữ',
      subtitle: 'Nhiều phrasal verbs cần object phía sau.',
      layout: 'explain',
      accent: 'green',
      formula: 'S + phrasal verb + object',
      bullets: [
        { content: 'Object có thể là place, plan, project, people hoặc problem.' },
        { content: 'Một số cụm không thể tách object ra giữa.' },
      ],
      examples: [
        'The city will carry out a new transport plan.',
        'Tourists can get around the city by metro.',
        'Young people often hang out with their friends downtown.',
      ],
    },
    {
      id: 's25',
      title: 'Phrasal verbs Unit 2',
      subtitle: 'Các cụm quan trọng trong chủ đề City Life.',
      layout: 'cards',
      cards: [
        {
          title: 'get around',
          accent: 'blue',
          content: 'di chuyển quanh',
          example: 'I get around the city by sky train.',
        },
        {
          title: 'show around',
          accent: 'green',
          content: 'dẫn đi tham quan',
          example: 'My cousin showed me around the city.',
        },
        {
          title: 'carry out',
          accent: 'orange',
          content: 'thực hiện / tiến hành',
          example: 'They carried out a transport project.',
        },
        {
          title: 'come down with',
          accent: 'purple',
          content: 'mắc bệnh',
          example: 'He came down with a cold because of pollution.',
        },
      ],
    },
    {
      id: 's26',
      title: 'Các cụm khác cần nhớ',
      subtitle: 'Dùng để nói về đời sống thành phố và vấn đề đô thị.',
      layout: 'cards',
      cards: [
        {
          title: 'hang out with',
          accent: 'blue',
          content: 'đi chơi / tụ tập với',
          example: 'Teens hang out with friends at malls.',
        },
        {
          title: 'cut down on',
          accent: 'green',
          content: 'cắt giảm',
          example: 'We should cut down on private vehicles.',
        },
        {
          title: 'set up',
          accent: 'orange',
          content: 'thành lập / thiết lập',
          example: 'The city set up a new bus route.',
        },
        {
          title: 'put up with',
          accent: 'purple',
          content: 'chịu đựng',
          example: 'People have to put up with noise and traffic.',
        },
      ],
    },
    {
      id: 's27',
      title: 'Di chuyển trong thành phố',
      subtitle: 'Dùng get around và show around với city / downtown / old quarter.',
      layout: 'cards',
      cards: [
        {
          title: 'Metro',
          accent: 'blue',
          content: 'I get around the city by metro.',
        },
        {
          title: 'Downtown',
          accent: 'green',
          content: 'Tourists can get around downtown easily.',
        },
        {
          title: 'Old quarter',
          accent: 'orange',
          content: 'My uncle showed me around the old quarter.',
        },
      ],
    },
    {
      id: 's28',
      title: 'Dự án và phát triển đô thị',
      subtitle: 'Dùng carry out, set up, build up với plan, project, station, amenities.',
      layout: 'cards',
      cards: [
        {
          title: 'Transport plan',
          accent: 'blue',
          content: 'The local government carried out a plan to reduce traffic jams.',
        },
        {
          title: 'Bike stations',
          accent: 'green',
          content: 'They set up more public bike stations.',
        },
        {
          title: 'Amenities',
          accent: 'orange',
          content: 'The city built up more modern public amenities.',
        },
      ],
    },
    {
      id: 's29',
      title: 'Đời sống giới trẻ',
      subtitle: 'Dùng hang out with, look around, find out about.',
      layout: 'cards',
      cards: [
        {
          title: 'Cafés',
          accent: 'blue',
          content: 'Teenagers often hang out with friends at cafés.',
        },
        {
          title: 'Malls',
          accent: 'green',
          content: 'My friends and I look around shopping malls at weekends.',
        },
        {
          title: 'New places',
          accent: 'orange',
          content: 'We like to find out about new places in the city.',
        },
      ],
    },
    {
      id: 's30',
      title: 'Vấn đề thành phố',
      subtitle: 'Dùng cut down on, put up with, come down with.',
      layout: 'cards',
      cards: [
        {
          title: 'Private cars',
          accent: 'green',
          content: 'People should cut down on using private cars.',
        },
        {
          title: 'Noise',
          accent: 'orange',
          content: 'Many residents have to put up with noise every day.',
        },
        {
          title: 'Health',
          accent: 'purple',
          content: 'Some people come down with health problems because of pollution.',
        },
      ],
    },
    {
      id: 's31',
      title: 'Tách được và không tách được',
      subtitle: 'Một số phrasal verbs có thể tách object, một số thì không.',
      layout: 'cards',
      cards: [
        {
          title: 'Tách được',
          accent: 'blue',
          content: 'turn down the music = turn the music down',
          example: 'Please turn it down.',
        },
        {
          title: 'Không tách được',
          accent: 'green',
          content: 'get around + place',
          example: 'I get around the city by bus.',
        },
        {
          title: 'Không tách được',
          accent: 'orange',
          content: 'hang out with + someone',
          example: 'She hangs out with her friends.',
        },
        {
          title: 'Không tách được',
          accent: 'purple',
          content: 'cut down on + noun / V-ing',
          example: 'We should cut down on traffic.',
        },
      ],
    },
    {
      id: 's32',
      title: 'Không dịch từng từ',
      subtitle: 'Phrasal verbs có nghĩa riêng trong ngữ cảnh.',
      layout: 'cards',
      cards: [
        {
          title: 'get around',
          accent: 'blue',
          content: 'Không phải “lấy xung quanh”.',
          example: 'get around = di chuyển quanh',
        },
        {
          title: 'carry out',
          accent: 'green',
          content: 'Không phải “mang ra ngoài”.',
          example: 'carry out = thực hiện / tiến hành',
        },
        {
          title: 'put up with',
          accent: 'orange',
          content: 'Không dịch từng từ.',
          example: 'put up with = chịu đựng',
        },
      ],
    },
    {
      id: 's33',
      title: 'Chú ý particle',
      subtitle: 'Sai particle có thể làm câu sai nghĩa hoặc sai ngữ pháp.',
      layout: 'cards',
      cards: [
        {
          title: 'get around',
          accent: 'red',
          content: 'Sai: get on the city',
          example: 'Đúng: get around the city',
        },
        {
          title: 'hang out with',
          accent: 'red',
          content: 'Sai: hang out friends',
          example: 'Đúng: hang out with friends',
        },
        {
          title: 'cut down on',
          accent: 'red',
          content: 'Sai: cut down private vehicles',
          example: 'Đúng: cut down on private vehicles',
        },
      ],
    },
    {
      id: 's34',
      title: 'Một động từ, nhiều particle',
      subtitle: 'Get có nhiều cụm khác nhau và mỗi cụm có nghĩa riêng.',
      layout: 'cards',
      cards: [
        {
          title: 'get around',
          accent: 'blue',
          content: 'di chuyển quanh',
        },
        {
          title: 'get on with',
          accent: 'green',
          content: 'hòa thuận với',
        },
        {
          title: 'get off',
          accent: 'orange',
          content: 'xuống xe',
        },
        {
          title: 'get back',
          accent: 'purple',
          content: 'quay lại',
        },
      ],
    },
    {
      id: 's35',
      title: 'Ví dụ phân tích phrasal verbs',
      subtitle: 'Dùng trong câu về giao thông và đời sống thành phố.',
      layout: 'cards',
      cards: [
        {
          title: 'Get around',
          accent: 'blue',
          content: 'I get around the city by underground.',
          example: 'Get around = di chuyển quanh một nơi.',
        },
        {
          title: 'Carry out',
          accent: 'green',
          content: 'The city is carrying out a project to build more metro lines.',
          example: 'Carry out = thực hiện kế hoạch / dự án.',
        },
        {
          title: 'Cut down on',
          accent: 'orange',
          content: 'We should cut down on private cars to reduce traffic jams.',
          example: 'Cut down on = cắt giảm số lượng hoặc mức độ.',
        },
      ],
    },
    {
      id: 's36',
      title: 'Từ vựng: Địa điểm trong thành phố',
      subtitle: 'Các địa điểm thường gặp trong chủ đề City Life.',
      layout: 'cards',
      cards: [
        {
          title: 'City areas',
          accent: 'blue',
          content: 'city, downtown, suburb, residential area, business district',
          example: 'Many offices are downtown.',
        },
        {
          title: 'Public places',
          accent: 'green',
          content: 'shopping mall, public park, metro station, construction site',
          example: 'Teens often hang out at shopping malls.',
        },
        {
          title: 'Amenities',
          accent: 'orange',
          content: 'public amenities',
          example: 'The city has many public amenities.',
        },
      ],
    },
    {
      id: 's37',
      title: 'Từ vựng: Giao thông và vấn đề thành phố',
      subtitle: 'Dùng trong double comparatives và phrasal verbs.',
      layout: 'cards',
      cards: [
        {
          title: 'Transport',
          accent: 'blue',
          content: 'public transport, bus, metro, underground, sky train, taxi, route',
          example: 'Public transport helps reduce traffic.',
        },
        {
          title: 'Traffic',
          accent: 'green',
          content: 'traffic jam, rush hour, private vehicle, reliable',
          example: 'Roads are crowded during rush hour.',
        },
        {
          title: 'Problems',
          accent: 'orange',
          content: 'pollution, air pollution, noise pollution, overcrowded, dusty, itchy eyes',
          example: 'Air pollution affects people’s health.',
        },
      ],
    },
    {
      id: 's38',
      title: 'Từ vựng: Tính từ miêu tả thành phố',
      subtitle: 'Dùng để nhận xét city life trong câu so sánh kép.',
      layout: 'cards',
      cards: [
        {
          title: 'Positive',
          accent: 'green',
          content: 'modern, attractive, convenient, comfortable, multicultural',
          example: 'City life is convenient.',
        },
        {
          title: 'Old and historic',
          accent: 'blue',
          content: 'ancient, historic',
          example: 'The old quarter has ancient houses.',
        },
        {
          title: 'Problems',
          accent: 'orange',
          content: 'crowded, noisy, populous, stressful, pricey',
          example: 'The streets are crowded.',
        },
      ],
    },
    {
      id: 's39',
      title: 'Cấu trúc giao tiếp thường gặp',
      subtitle: 'Dùng để nói về giao thông, vấn đề và dự án đô thị.',
      layout: 'cards',
      cards: [
        {
          title: 'Get around',
          accent: 'blue',
          content: 'S + get around + place + by + means of transport.',
          example: 'I get around the city by bus.',
        },
        {
          title: 'Double comparative',
          accent: 'green',
          content: 'The + comparative + S + V, the + comparative + S + V.',
          example: 'The better public transport is, the easier city life becomes.',
        },
        {
          title: 'Cut down on',
          accent: 'orange',
          content: 'S + should + cut down on + noun / V-ing.',
          example: 'We should cut down on private vehicles.',
        },
        {
          title: 'Carry out',
          accent: 'purple',
          content: 'S + carry out + a plan / project + to V.',
          example: 'The city carried out a project to improve roads.',
        },
      ],
    },
    {
      id: 's40',
      title: 'Tổng kết Unit 2',
      subtitle: 'City Life',
      layout: 'practice',
      accent: 'blue',
      sections: [
        {
          title: 'Double comparatives',
          content: 'The + comparative + S + V, the + comparative + S + V.',
          example: 'The bigger the city is, the more crowded it becomes.',
        },
        {
          title: 'The more / less',
          content: 'The more..., the more...; The more..., the less...; The less..., the more...',
          example: 'The more people use buses, the less traffic there is.',
        },
        {
          title: 'Phrasal verbs',
          content: 'get around, carry out, cut down on, hang out with, put up with, set up.',
          example: 'The city is carrying out a new transport plan.',
        },
      ],
    },
  ],
};

export default deck;
