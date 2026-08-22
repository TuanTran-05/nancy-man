import { LessonDeck } from '../../../types';

const deck: LessonDeck = {
  id: 'gs-g9-u10-nature-and-planet-earth',
  curriculumFamily: 'global-success',
  grade: 9,
  unitNumber: 10,
  title: 'Grammar Grade 9 - Unit 10: Nature and Planet Earth',
  description:
    'Bài giảng Unit 10 Global Success 9 về non-defining relative clauses, combining sentences và từ vựng Nature and Planet Earth.',
  createdAt: '2026-05-18T00:00:00.000Z',
  slides: [
    {
      id: 's1',
      title: 'GRAMMAR GRADE 9',
      subtitle: 'UNIT 10: NATURE AND PLANET EARTH',
      label: 'NỘI DUNG BÀI HỌC:',
      layout: 'outline',
      cards: [
        {
          title: 'NON-DEFINING RELATIVE CLAUSES',
          subtitle: '(Mệnh đề quan hệ không xác định)',
          accent: 'green',
        },
        {
          title: 'COMBINING SENTENCES',
          subtitle: '(Kết hợp câu)',
          accent: 'blue',
        },
        {
          title: 'NATURE AND PLANET EARTH VOCABULARY',
          subtitle: '(Từ vựng thiên nhiên và Trái Đất)',
          accent: 'orange',
        },
      ],
    },
    {
      id: 's2',
      title: 'Mục tiêu bài học',
      layout: 'objectives',
      bullets: [
        { content: 'Nhận biết mệnh đề quan hệ không xác định và dùng dấu phẩy đúng.' },
        {
          content:
            'Dùng who, whom, which, whose, where, when để bổ sung thông tin về người, vật, nơi chốn và thời gian.',
        },
        {
          content: 'Phân biệt defining và non-defining relative clauses trong chủ đề thiên nhiên.',
        },
        { content: 'Kết hợp hai câu đơn thành câu có mệnh đề quan hệ không xác định.' },
      ],
    },
    {
      id: 's3',
      title: 'Phần 1',
      subtitle: 'Non-defining Relative Clauses',
      layout: 'section-cover',
      accent: 'green',
    },
    {
      id: 's4',
      title: 'Non-defining Relative Clause là gì?',
      subtitle: 'Mệnh đề bổ sung thông tin thêm cho danh từ đứng trước.',
      layout: 'explain',
      accent: 'green',
      formula: 'Noun, + relative clause, + main clause',
      bullets: [
        { content: 'Thông tin trong mệnh đề không bắt buộc để hiểu ý chính.' },
        { content: 'Nếu bỏ mệnh đề này đi, câu vẫn đủ nghĩa.' },
        { content: 'Mệnh đề được tách bằng dấu phẩy.' },
      ],
      examples: [
        'The Earth, which is our home planet, needs protection.',
        'Bees, which are important for plants, are disappearing in some areas.',
        'Dr Jane Goodall, who studies chimpanzees, is a famous scientist.',
      ],
    },
    {
      id: 's5',
      title: 'Đặc điểm chính',
      subtitle: 'Bốn dấu hiệu quan trọng của mệnh đề quan hệ không xác định.',
      layout: 'cards',
      cards: [
        {
          title: 'Thêm thông tin phụ',
          accent: 'green',
          content: 'Mệnh đề chỉ bổ sung thêm thông tin.',
          example: 'The Earth, which is our home, is getting warmer.',
        },
        {
          title: 'Có dấu phẩy',
          accent: 'blue',
          content: 'Dùng dấu phẩy để tách mệnh đề quan hệ.',
          example: 'Bees, which make honey, are useful insects.',
        },
        {
          title: 'Không dùng that',
          accent: 'red',
          content: 'Dùng who, whom, which, whose, where, when.',
          example: 'My school, which has a green club, plants trees every year.',
        },
        {
          title: 'Không lược bỏ đại từ',
          accent: 'orange',
          content: 'Không bỏ who / which / whose trong loại mệnh đề này.',
          example: 'The forest, which is protected, is very large.',
        },
      ],
    },
    {
      id: 's6',
      title: 'Với người: Who / Whom',
      subtitle: 'Dùng who khi người làm chủ ngữ, whom khi người làm tân ngữ.',
      layout: 'cards',
      cards: [
        {
          title: 'Who',
          accent: 'green',
          content: 'Person, who + V + ...',
          example: 'My science teacher, who loves nature, teaches us about the environment.',
        },
        {
          title: 'Who',
          accent: 'blue',
          content: 'Dùng khi mệnh đề sau who thiếu chủ ngữ.',
          example: 'The scientist, who studies climate change, gave a speech yesterday.',
        },
        {
          title: 'Whom',
          accent: 'purple',
          content: 'Person, whom + S + V + ...',
          example: 'The volunteer, whom we met at the cleanup event, was very friendly.',
        },
      ],
    },
    {
      id: 's7',
      title: 'Với vật, động vật, sự việc: Which',
      subtitle: 'Dùng which để bổ sung thông tin về vật, con vật hoặc vấn đề.',
      layout: 'explain',
      accent: 'blue',
      formula: 'Thing / animal / idea, + which + V / S + V, + main clause',
      bullets: [
        { content: 'Which có thể làm chủ ngữ trong mệnh đề quan hệ.' },
        { content: 'Which cũng có thể làm tân ngữ khi sau nó có chủ ngữ khác.' },
        { content: 'Không thay which bằng that trong mệnh đề không xác định.' },
      ],
      examples: [
        'The Amazon Rainforest, which produces a lot of oxygen, is very important.',
        'Plastic waste, which harms sea animals, is a serious problem.',
        'The coral reef, which is home to many sea creatures, is in danger.',
      ],
    },
    {
      id: 's8',
      title: 'Với sở hữu: Whose',
      subtitle: 'Sau whose luôn có danh từ.',
      layout: 'explain',
      accent: 'orange',
      formula: 'Noun, + whose + noun + V + ..., + main clause',
      bullets: [
        { content: 'Whose dùng để thay thế his / her / its / their + noun.' },
        { content: 'Không viết whose its / whose their.' },
        { content: 'Whose có thể dùng với người, động vật hoặc vật trong văn viết.' },
      ],
      examples: [
        'The saola, whose habitat is forests, is very rare.',
        'The turtle, whose shell was damaged, was rescued by volunteers.',
        'The forest, whose trees are very old, is protected by local people.',
      ],
    },
    {
      id: 's9',
      title: 'Với nơi chốn: Where',
      subtitle: 'Dùng where để bổ sung thông tin về địa điểm.',
      layout: 'explain',
      accent: 'green',
      formula: 'Place, + where + S + V + ..., + main clause',
      bullets: [
        { content: 'Where thay cho in / at / on + place.' },
        { content: 'Mệnh đề where đứng ngay sau địa điểm được bổ nghĩa.' },
        { content: 'Vẫn dùng dấu phẩy vì đây là mệnh đề không xác định.' },
      ],
      examples: [
        'Cat Ba National Park, where many rare animals live, is in Viet Nam.',
        'The Amazon Rainforest, where many species are found, is very large.',
        'The beach, where volunteers collected rubbish, is cleaner now.',
      ],
    },
    {
      id: 's10',
      title: 'Với thời gian: When',
      subtitle: 'Dùng when để bổ sung thông tin về thời điểm.',
      layout: 'explain',
      accent: 'purple',
      formula: 'Time, + when + S + V + ..., + main clause',
      bullets: [
        { content: 'When thay cho on / in / at + time.' },
        { content: 'Có thể dùng với ngày lễ, mùa, năm hoặc một mốc thời gian đã xác định.' },
        { content: 'Mệnh đề when cũng được tách bằng dấu phẩy.' },
      ],
      examples: [
        'Earth Day, when people do activities to protect the planet, is celebrated every year.',
        'Last summer, when our class planted trees, was very meaningful.',
        '2024, when many students joined the green campaign, was an important year for our school.',
      ],
    },
    {
      id: 's11',
      title: 'Defining và Non-defining',
      subtitle: 'Phân biệt mệnh đề xác định và không xác định.',
      layout: 'cards',
      cards: [
        {
          title: 'Defining',
          accent: 'blue',
          content: 'Xác định rõ danh từ, thông tin cần thiết, không dùng dấu phẩy.',
          example: 'The forest which is near my village is protected.',
        },
        {
          title: 'Non-defining',
          accent: 'green',
          content: 'Thêm thông tin phụ, dùng dấu phẩy, không dùng that.',
          example: 'Cuc Phuong National Park, which is in Viet Nam, is very famous.',
        },
        {
          title: 'Mẹo nhớ',
          accent: 'orange',
          content: 'Tên riêng hoặc danh từ đã xác định thường dùng non-defining clause.',
          example: 'The Earth, which is our home planet, needs protection.',
        },
      ],
    },
    {
      id: 's12',
      title: 'Đại từ quan hệ cần nhớ',
      subtitle: 'Chọn đúng từ theo danh từ được bổ nghĩa.',
      layout: 'cards',
      cards: [
        {
          title: 'Who / Whom',
          accent: 'green',
          content: 'Dùng cho người.',
          example: 'The scientist, who studies animals, is famous.',
        },
        {
          title: 'Which',
          accent: 'blue',
          content: 'Dùng cho vật, con vật, sự việc.',
          example: 'Plastic waste, which pollutes the sea, is dangerous.',
        },
        {
          title: 'Whose',
          accent: 'orange',
          content: 'Dùng cho sở hữu.',
          example: 'The turtle, whose shell was broken, was rescued.',
        },
        {
          title: 'Where / When',
          accent: 'purple',
          content: 'Dùng cho nơi chốn và thời gian.',
          example: 'Earth Day, when people protect the planet, is important.',
        },
      ],
    },
    {
      id: 's13',
      title: 'Không dùng That',
      subtitle: 'That không dùng trong mệnh đề quan hệ không xác định.',
      layout: 'cards',
      cards: [
        {
          title: 'Sai',
          accent: 'red',
          content: 'The Earth, that is our home planet, needs protection.',
        },
        {
          title: 'Đúng',
          accent: 'green',
          content: 'The Earth, which is our home planet, needs protection.',
        },
        {
          title: 'Sai',
          accent: 'red',
          content: 'My teacher, that loves nature, started a green club.',
        },
        {
          title: 'Đúng',
          accent: 'green',
          content: 'My teacher, who loves nature, started a green club.',
        },
      ],
    },
    {
      id: 's14',
      title: 'Không lược bỏ đại từ quan hệ',
      subtitle: 'Who / which / whose phải xuất hiện trong mệnh đề không xác định.',
      layout: 'cards',
      cards: [
        {
          title: 'Sai',
          accent: 'red',
          content: 'The Amazon Rainforest, produces a lot of oxygen, is important.',
        },
        {
          title: 'Đúng',
          accent: 'green',
          content: 'The Amazon Rainforest, which produces a lot of oxygen, is important.',
        },
        {
          title: 'Sai',
          accent: 'red',
          content: 'Dr Jane Goodall, studies chimpanzees, is famous.',
        },
        {
          title: 'Đúng',
          accent: 'green',
          content: 'Dr Jane Goodall, who studies chimpanzees, is famous.',
        },
      ],
    },
    {
      id: 's15',
      title: 'Dấu phẩy: mệnh đề nằm giữa câu',
      subtitle: 'Dùng hai dấu phẩy khi mệnh đề quan hệ chen giữa câu.',
      layout: 'explain',
      accent: 'green',
      formula: 'Subject, + relative clause, + verb / main clause',
      bullets: [
        { content: 'Dấu phẩy thứ nhất đặt trước đại từ quan hệ.' },
        { content: 'Dấu phẩy thứ hai đặt sau khi mệnh đề quan hệ kết thúc.' },
        { content: 'Nếu bỏ phần giữa hai dấu phẩy, câu chính vẫn đủ nghĩa.' },
      ],
      examples: [
        'The Earth, which is our home, is getting warmer.',
        'Bees, which help plants grow, are very important.',
        'My teacher, who started a green project, loves nature.',
      ],
    },
    {
      id: 's16',
      title: 'Dấu phẩy: mệnh đề nằm cuối câu',
      subtitle: 'Dùng một dấu phẩy trước mệnh đề quan hệ.',
      layout: 'explain',
      accent: 'blue',
      formula: 'Main clause, + relative clause.',
      bullets: [
        { content: 'Mệnh đề quan hệ cuối câu bổ sung thông tin cho danh từ ngay trước nó.' },
        { content: 'Không cần dấu phẩy thứ hai vì câu kết thúc ở cuối mệnh đề.' },
        { content: 'Vẫn không dùng that.' },
      ],
      examples: [
        'We visited Cat Ba National Park, which is famous for its biodiversity.',
        'I met a scientist, who studies endangered animals.',
        'Our class cleaned the beach, which was full of plastic waste.',
      ],
    },
    {
      id: 's17',
      title: 'Dùng trong chủ đề Trái Đất',
      subtitle: 'Bổ sung thông tin về môi trường và hành tinh.',
      layout: 'cards',
      cards: [
        {
          title: 'The Earth',
          accent: 'green',
          content: 'The Earth, which gives us water and air, must be protected.',
        },
        {
          title: 'Climate change',
          accent: 'orange',
          content: 'Climate change, which affects many countries, is a serious problem.',
        },
        {
          title: 'Pollution',
          accent: 'red',
          content: 'Pollution, which harms people and animals, should be reduced.',
        },
      ],
    },
    {
      id: 's18',
      title: 'Dùng với động vật',
      subtitle: 'Bổ sung thông tin về vai trò hoặc tình trạng nguy hiểm của động vật.',
      layout: 'cards',
      cards: [
        {
          title: 'Bees',
          accent: 'green',
          content: 'Bees, which help pollinate plants, are important to nature.',
        },
        {
          title: 'Saola',
          accent: 'orange',
          content: 'The saola, which is very rare, lives in forests in Viet Nam and Laos.',
        },
        {
          title: 'Sea turtles',
          accent: 'blue',
          content: 'Sea turtles, which often eat plastic by mistake, are in danger.',
        },
      ],
    },
    {
      id: 's19',
      title: 'Dùng với địa điểm tự nhiên',
      subtitle: 'Bổ sung thông tin về rừng, công viên quốc gia, rạn san hô.',
      layout: 'cards',
      cards: [
        {
          title: 'Amazon Rainforest',
          accent: 'green',
          content:
            'The Amazon Rainforest, which is the largest rainforest in the world, is home to many species.',
        },
        {
          title: 'Cat Ba National Park',
          accent: 'blue',
          content: 'Cat Ba National Park, where many rare animals live, attracts many visitors.',
        },
        {
          title: 'Great Barrier Reef',
          accent: 'orange',
          content:
            'The Great Barrier Reef, which is in Australia, is threatened by climate change.',
        },
      ],
    },
    {
      id: 's20',
      title: 'Lưu ý quan trọng',
      subtitle: 'Dùng dấu phẩy theo loại mệnh đề và loại danh từ.',
      layout: 'cards',
      cards: [
        {
          title: 'Không phẩy với defining',
          accent: 'red',
          content: 'The animals which live in this forest are protected.',
          example: 'Thông tin which live in this forest xác định con vật nào.',
        },
        {
          title: 'Có phẩy với tên riêng',
          accent: 'green',
          content: 'Cat Ba National Park, which is in Viet Nam, is famous.',
        },
        {
          title: 'Sau whose có danh từ',
          accent: 'orange',
          content: 'The bird, whose wings were injured, was rescued.',
        },
      ],
    },
    {
      id: 's21',
      title: 'Ví dụ phân tích',
      subtitle: 'Bỏ mệnh đề phụ, câu chính vẫn đủ nghĩa.',
      layout: 'cards',
      cards: [
        {
          title: 'The Earth',
          accent: 'green',
          content: 'The Earth, which is our home planet, needs protection.',
          example: 'Câu chính: The Earth needs protection.',
        },
        {
          title: 'Bees',
          accent: 'blue',
          content: 'Bees, which help plants grow, are important insects.',
          example: 'Câu chính: Bees are important insects.',
        },
        {
          title: 'The saola',
          accent: 'orange',
          content: 'The saola, whose habitat is forests, is endangered.',
          example: 'Whose habitat chỉ môi trường sống của sao la.',
        },
      ],
    },
    {
      id: 's22',
      title: 'Luyện tập: chọn đại từ quan hệ',
      subtitle: 'Điền who, whom, which, whose, where hoặc when.',
      layout: 'practice',
      accent: 'green',
      sections: [
        {
          title: 'Câu 1',
          content: 'The Earth, _____ is our home planet, needs protection.',
          example: 'which',
        },
        {
          title: 'Câu 2',
          content: 'My science teacher, _____ loves nature, started a green club.',
          example: 'who',
        },
        {
          title: 'Câu 3',
          content: 'The turtle, _____ shell was damaged, was rescued.',
          example: 'whose',
        },
      ],
    },
    {
      id: 's23',
      title: 'Sửa lỗi: Relative Clauses',
      subtitle: 'Tìm lỗi về dấu phẩy, that hoặc đại từ lặp.',
      layout: 'practice',
      accent: 'red',
      sections: [
        {
          title: 'Lỗi 1',
          content: 'The Earth, that is our home, needs protection.',
          example: 'The Earth, which is our home, needs protection.',
        },
        {
          title: 'Lỗi 2',
          content: 'Bees, which they help plants grow, are important.',
          example: 'Bees, which help plants grow, are important.',
        },
        {
          title: 'Lỗi 3',
          content: 'The turtle, whose its shell was damaged, was rescued.',
          example: 'The turtle, whose shell was damaged, was rescued.',
        },
      ],
    },
    {
      id: 's24',
      title: 'Phần 2',
      subtitle: 'Combining Sentences',
      layout: 'section-cover',
      accent: 'blue',
    },
    {
      id: 's25',
      title: 'Combining Sentences là gì?',
      subtitle: 'Kết hợp hai câu đơn để bài viết tự nhiên và tránh lặp từ.',
      layout: 'explain',
      accent: 'blue',
      formula: 'Sentence 1 + non-defining relative clause',
      bullets: [
        { content: 'Tìm danh từ hoặc đại từ bị lặp trong hai câu.' },
        { content: 'Chọn đại từ quan hệ phù hợp.' },
        { content: 'Đặt mệnh đề quan hệ ngay sau danh từ được bổ nghĩa.' },
        { content: 'Thêm dấu phẩy vì đây là mệnh đề không xác định.' },
      ],
      examples: [
        'The Earth needs protection. It is our home planet.',
        'The Earth, which is our home planet, needs protection.',
      ],
    },
    {
      id: 's26',
      title: 'Bốn bước kết hợp câu',
      subtitle: 'Áp dụng với thông tin về thiên nhiên và môi trường.',
      layout: 'cards',
      cards: [
        {
          title: 'Bước 1',
          accent: 'blue',
          content: 'Tìm danh từ bị lặp.',
          example: 'The Amazon Rainforest = It',
        },
        {
          title: 'Bước 2',
          accent: 'green',
          content: 'Chọn đại từ quan hệ phù hợp.',
          example: 'It chỉ vật / địa điểm tự nhiên lớn, dùng which.',
        },
        {
          title: 'Bước 3',
          accent: 'orange',
          content: 'Đặt mệnh đề ngay sau danh từ.',
          example: 'The Amazon Rainforest, which is home to many animals, ...',
        },
        {
          title: 'Bước 4',
          accent: 'purple',
          content: 'Thêm dấu phẩy.',
          example: 'The Amazon Rainforest, which is home to many animals, is very large.',
        },
      ],
    },
    {
      id: 's27',
      title: 'Kết hợp câu với Who',
      subtitle: 'Dùng khi danh từ lặp là người và làm chủ ngữ.',
      layout: 'practice',
      accent: 'green',
      sections: [
        {
          title: 'Ví dụ 1',
          content: 'My science teacher is very kind. She started a green club.',
          example: 'My science teacher, who started a green club, is very kind.',
        },
        {
          title: 'Ví dụ 2',
          content: 'Dr Jane Goodall is famous. She studies chimpanzees.',
          example: 'Dr Jane Goodall, who studies chimpanzees, is famous.',
        },
        {
          title: 'Ví dụ 3',
          content: 'The volunteer helped us clean the beach. He loves nature.',
          example: 'The volunteer, who loves nature, helped us clean the beach.',
        },
      ],
    },
    {
      id: 's28',
      title: 'Kết hợp câu với Whom',
      subtitle: 'Dùng khi người được nhắc lại làm tân ngữ.',
      layout: 'practice',
      accent: 'purple',
      sections: [
        {
          title: 'Ví dụ 1',
          content: 'The scientist gave a talk. We met him yesterday.',
          example: 'The scientist, whom we met yesterday, gave a talk.',
        },
        {
          title: 'Ví dụ 2',
          content: 'The volunteer was very helpful. We worked with her.',
          example: 'The volunteer, whom we worked with, was very helpful.',
        },
        {
          title: 'Ghi nhớ',
          content: 'Whom thường đứng sau dấu phẩy và trước một mệnh đề có chủ ngữ riêng.',
          example: 'whom we met / whom we worked with',
        },
      ],
    },
    {
      id: 's29',
      title: 'Kết hợp câu với Which',
      subtitle: 'Dùng cho vật, động vật hoặc sự việc.',
      layout: 'practice',
      accent: 'blue',
      sections: [
        {
          title: 'The Earth',
          content: 'The Earth needs protection. It is getting warmer.',
          example: 'The Earth, which is getting warmer, needs protection.',
        },
        {
          title: 'Plastic waste',
          content: 'Plastic waste harms sea animals. It is difficult to break down.',
          example: 'Plastic waste, which is difficult to break down, harms sea animals.',
        },
        {
          title: 'Bees',
          content: 'Bees are important insects. They help plants grow.',
          example: 'Bees, which help plants grow, are important insects.',
        },
      ],
    },
    {
      id: 's30',
      title: 'Kết hợp câu với Whose',
      subtitle: 'Dùng khi câu sau có its / his / her / their + noun.',
      layout: 'practice',
      accent: 'orange',
      sections: [
        {
          title: 'The turtle',
          content: 'The turtle was rescued. Its shell was damaged.',
          example: 'The turtle, whose shell was damaged, was rescued.',
        },
        {
          title: 'The saola',
          content: 'The saola is endangered. Its habitat is disappearing.',
          example: 'The saola, whose habitat is disappearing, is endangered.',
        },
        {
          title: 'The forest',
          content: 'The forest is protected. Its trees are very old.',
          example: 'The forest, whose trees are very old, is protected.',
        },
      ],
    },
    {
      id: 's31',
      title: 'Kết hợp câu với Where',
      subtitle: 'Dùng khi câu sau có there chỉ nơi chốn.',
      layout: 'practice',
      accent: 'green',
      sections: [
        {
          title: 'Cat Ba National Park',
          content: 'Cat Ba National Park is famous. Many rare animals live there.',
          example: 'Cat Ba National Park, where many rare animals live, is famous.',
        },
        {
          title: 'The beach',
          content: 'The beach is cleaner now. We collected rubbish there.',
          example: 'The beach, where we collected rubbish, is cleaner now.',
        },
        {
          title: 'The rainforest',
          content: 'The rainforest is very important. Many species live there.',
          example: 'The rainforest, where many species live, is very important.',
        },
      ],
    },
    {
      id: 's32',
      title: 'Kết hợp câu với When',
      subtitle: 'Dùng khi câu sau nhắc lại mốc thời gian.',
      layout: 'practice',
      accent: 'purple',
      sections: [
        {
          title: 'Earth Day',
          content:
            'Earth Day is important. People do activities to protect the planet on that day.',
          example: 'Earth Day, when people do activities to protect the planet, is important.',
        },
        {
          title: 'Last Sunday',
          content: 'Last Sunday was meaningful. Our class cleaned the park then.',
          example: 'Last Sunday, when our class cleaned the park, was meaningful.',
        },
        {
          title: 'Ghi nhớ',
          content: 'When thay cho on that day / then / in that year.',
          example: 'Earth Day, when people plant trees, is important.',
        },
      ],
    },
    {
      id: 's33',
      title: 'Bảng tóm tắt cách kết hợp',
      subtitle: 'Nhìn danh từ lặp để chọn từ quan hệ.',
      layout: 'cards',
      cards: [
        {
          title: 'Người',
          accent: 'green',
          content: 'who / whom',
          example: 'My teacher, who loves nature, started a club.',
        },
        {
          title: 'Vật / động vật',
          accent: 'blue',
          content: 'which',
          example: 'The Earth, which is warming, needs help.',
        },
        {
          title: 'Sở hữu',
          accent: 'orange',
          content: 'whose + noun',
          example: 'The turtle, whose shell was damaged, was rescued.',
        },
        {
          title: 'Nơi chốn / thời gian',
          accent: 'purple',
          content: 'where / when',
          example: 'Earth Day, when people plant trees, is important.',
        },
      ],
    },
    {
      id: 's34',
      title: 'Lỗi thường gặp khi kết hợp câu',
      subtitle: 'Tránh các lỗi làm câu sai ngữ pháp hoặc sai nghĩa.',
      layout: 'cards',
      cards: [
        {
          title: 'Quên dấu phẩy',
          accent: 'red',
          content: 'Sai: The Earth which is our home planet needs protection.',
          example: 'Đúng: The Earth, which is our home planet, needs protection.',
        },
        {
          title: 'Dùng that',
          accent: 'red',
          content: 'Sai: Bees, that help plants grow, are important.',
          example: 'Đúng: Bees, which help plants grow, are important.',
        },
        {
          title: 'Lặp đại từ',
          accent: 'orange',
          content: 'Sai: The Earth, which it is our home planet, needs protection.',
          example: 'Đúng: The Earth, which is our home planet, needs protection.',
        },
      ],
    },
    {
      id: 's35',
      title: 'Đặt mệnh đề đúng vị trí',
      subtitle: 'Mệnh đề quan hệ phải đứng ngay sau danh từ được bổ nghĩa.',
      layout: 'cards',
      cards: [
        {
          title: 'Sai vị trí',
          accent: 'red',
          content: 'The Earth needs protection, which is our home planet.',
        },
        {
          title: 'Đúng vị trí',
          accent: 'green',
          content: 'The Earth, which is our home planet, needs protection.',
        },
        {
          title: 'Mẹo kiểm tra',
          accent: 'blue',
          content:
            'Đọc danh từ ngay trước dấu phẩy để xem mệnh đề quan hệ đang bổ nghĩa cho ai / cái gì.',
        },
      ],
    },
    {
      id: 's36',
      title: 'Phần 3',
      subtitle: 'Nature and Planet Earth Vocabulary',
      layout: 'section-cover',
      accent: 'orange',
    },
    {
      id: 's37',
      title: 'Từ vựng: Thiên nhiên và môi trường',
      subtitle: 'Các khái niệm chính trong Unit 10.',
      layout: 'cards',
      cards: [
        {
          title: 'Nature',
          accent: 'green',
          content: 'nature, planet, the Earth, environment, ecosystem',
          example: 'We should protect nature.',
        },
        {
          title: 'Environmental problems',
          accent: 'orange',
          content: 'climate change, global warming, pollution',
          example: 'Climate change affects many countries.',
        },
        {
          title: 'Protection',
          accent: 'blue',
          content: 'biodiversity, conservation',
          example: 'Conservation helps protect wildlife.',
        },
      ],
    },
    {
      id: 's38',
      title: 'Từ vựng: Địa điểm tự nhiên',
      subtitle: 'Rừng, biển, sông, núi và các khu vực tự nhiên.',
      layout: 'cards',
      cards: [
        {
          title: 'Land',
          accent: 'green',
          content: 'forest, rainforest, mountain, island, national park',
          example: 'Cat Ba National Park is in Viet Nam.',
        },
        {
          title: 'Water',
          accent: 'blue',
          content: 'river, ocean, sea, beach, coral reef',
          example: 'Coral reefs are in danger.',
        },
        {
          title: 'Relative clause practice',
          accent: 'purple',
          content: 'The beach, where volunteers cleaned up rubbish, is cleaner now.',
        },
      ],
    },
    {
      id: 's39',
      title: 'Từ vựng: Động vật, thực vật và bảo vệ môi trường',
      subtitle: 'Dùng để nói về loài bị đe dọa và hành động bảo vệ.',
      layout: 'cards',
      cards: [
        {
          title: 'Wildlife',
          accent: 'green',
          content: 'wildlife, species, endangered animal, rare animal, bee, turtle, bird, saola',
          example: 'The saola is one of the rarest animals.',
        },
        {
          title: 'Plants',
          accent: 'blue',
          content: 'plant, tree',
          example: 'Trees help clean the air.',
        },
        {
          title: 'Actions',
          accent: 'orange',
          content: 'protect, save, reduce, recycle, reuse, plant trees, clean up, rescue',
          example: 'The turtle was rescued by volunteers.',
        },
      ],
    },
    {
      id: 's40',
      title: 'Tổng kết Unit 10',
      subtitle: 'Nature and Planet Earth',
      layout: 'practice',
      accent: 'green',
      sections: [
        {
          title: 'Non-defining relative clauses',
          content: 'Noun, + who / whom / which / whose / where / when + clause, + main clause.',
          example: 'The Earth, which is our home planet, needs protection.',
        },
        {
          title: 'Combining sentences',
          content: 'Tìm danh từ lặp, chọn từ quan hệ, đặt mệnh đề ngay sau danh từ, thêm dấu phẩy.',
          example: 'The saola, whose habitat is disappearing, is endangered.',
        },
        {
          title: 'Lỗi cần tránh',
          content:
            'Không dùng that, không lược bỏ đại từ quan hệ, không lặp it / its sau which / whose.',
          example: 'Bees, which help plants grow, are important insects.',
        },
      ],
    },
  ],
};

export default deck;
