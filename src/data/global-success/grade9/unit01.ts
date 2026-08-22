import { LessonDeck } from '../../../types';

const deck: LessonDeck = {
  id: 'gs-g9-u1-local-community',
  curriculumFamily: 'global-success',
  grade: 9,
  unitNumber: 1,
  title: 'Grammar Grade 9 - Unit 1: Local Community',
  description:
    'Bài giảng Unit 1 Global Success 9 về phrasal verbs, question words before to-infinitives và từ vựng Local Community.',
  createdAt: '2026-05-18T00:00:00.000Z',
  slides: [
    {
      id: 's1',
      title: 'GRAMMAR GRADE 9',
      subtitle: 'UNIT 1: LOCAL COMMUNITY',
      label: 'NỘI DUNG BÀI HỌC:',
      layout: 'outline',
      cards: [
        {
          title: 'PHRASAL VERBS',
          subtitle: '(Cụm động từ)',
          accent: 'blue',
        },
        {
          title: 'QUESTION WORDS BEFORE TO-INFINITIVES',
          subtitle: '(Từ để hỏi đứng trước to-infinitives)',
          accent: 'green',
        },
        {
          title: 'LOCAL COMMUNITY VOCABULARY',
          subtitle: '(Từ vựng cộng đồng địa phương)',
          accent: 'orange',
        },
      ],
    },
    {
      id: 's2',
      title: 'Mục tiêu bài học',
      layout: 'objectives',
      bullets: [
        { content: 'Hiểu cấu tạo và ý nghĩa của phrasal verbs trong chủ đề Local Community.' },
        {
          content: 'Dùng đúng các cụm như get on with, look around, find out, look after, set up.',
        },
        { content: 'Phân biệt phrasal verbs có thể tách và không thể tách.' },
        {
          content:
            'Dùng what / where / when / how / who / which + to V để hỏi, chỉ dẫn hoặc quyết định việc cần làm.',
        },
      ],
    },
    {
      id: 's3',
      title: 'Phần 1',
      subtitle: 'Phrasal Verbs',
      layout: 'section-cover',
      accent: 'blue',
    },
    {
      id: 's4',
      title: 'Phrasal verbs là gì?',
      subtitle: 'Cụm động từ được tạo thành từ verb + particle.',
      layout: 'explain',
      accent: 'blue',
      formula: 'Verb + particle',
      bullets: [
        { content: 'Verb là động từ chính.' },
        {
          content:
            'Particle là giới từ hoặc trạng từ ngắn như up, down, on, off, in, out, with, after, around.',
        },
        { content: 'Nghĩa của phrasal verb có thể khác với nghĩa gốc của từng từ.' },
      ],
      examples: [
        'We should look after public places in our community.',
        'I want to find out more about my local area.',
        'She gets on well with her neighbours.',
      ],
    },
    {
      id: 's5',
      title: 'Không có tân ngữ',
      subtitle: 'Một số phrasal verbs có thể đứng một mình sau chủ ngữ.',
      layout: 'explain',
      accent: 'blue',
      formula: 'S + phrasal verb',
      bullets: [
        { content: 'Không cần object phía sau cụm động từ.' },
        { content: 'Thường dùng để nói sự việc xảy ra trong cộng đồng.' },
        { content: 'Vẫn có thể thêm trạng ngữ thời gian hoặc nơi chốn.' },
      ],
      examples: [
        'The bus broke down.',
        'Many people moved in last year.',
        'My grandparents came back to the village.',
      ],
    },
    {
      id: 's6',
      title: 'Có tân ngữ',
      subtitle: 'Nhiều phrasal verbs cần object để hoàn chỉnh ý.',
      layout: 'explain',
      accent: 'green',
      formula: 'S + phrasal verb + object',
      bullets: [
        { content: 'Object là người, vật hoặc thông tin chịu tác động của hành động.' },
        { content: 'Một số cụm có object đứng sau cả phrasal verb.' },
        { content: 'Một số cụm có thể tách object vào giữa verb và particle.' },
      ],
      examples: [
        'We need to look after the playground.',
        'They want to find out the history of the village.',
        'The local people set up a community club.',
      ],
    },
    {
      id: 's7',
      title: 'Phrasal verbs chủ đề Local Community',
      subtitle: 'Các cụm quan trọng cần nhớ trong Unit 1.',
      layout: 'cards',
      cards: [
        {
          title: 'get on with',
          accent: 'blue',
          content: 'hòa thuận với',
          example: 'I get on well with my neighbours.',
        },
        {
          title: 'look around',
          accent: 'green',
          content: 'tham quan / nhìn quanh',
          example: 'Tourists look around the craft village.',
        },
        {
          title: 'find out',
          accent: 'orange',
          content: 'tìm hiểu / phát hiện',
          example: 'We found out about the local festival.',
        },
        {
          title: 'look after',
          accent: 'purple',
          content: 'chăm sóc / bảo quản',
          example: 'People should look after public facilities.',
        },
      ],
    },
    {
      id: 's8',
      title: 'Các phrasal verbs khác',
      subtitle: 'Dùng để nói về cư dân, địa điểm và hoạt động cộng đồng.',
      layout: 'cards',
      cards: [
        {
          title: 'move in',
          accent: 'blue',
          content: 'chuyển đến sống',
          example: 'A new family moved in next door.',
        },
        {
          title: 'come back',
          accent: 'green',
          content: 'quay lại',
          example: 'Many visitors come back to the village.',
        },
        {
          title: 'set up',
          accent: 'orange',
          content: 'thành lập / thiết lập',
          example: 'They set up a youth club.',
        },
        {
          title: 'turn into',
          accent: 'purple',
          content: 'biến thành',
          example: 'The old building turned into a museum.',
        },
      ],
    },
    {
      id: 's9',
      title: 'Quan hệ với hàng xóm',
      subtitle: 'Dùng get on with để nói về mối quan hệ trong cộng đồng.',
      layout: 'cards',
      cards: [
        {
          title: 'Positive',
          accent: 'green',
          content: 'I get on with my neighbours very well.',
        },
        {
          title: 'Negative',
          accent: 'orange',
          content: 'She does not get on with some people in her area.',
        },
        {
          title: 'Advice',
          accent: 'blue',
          content: 'New residents should try to get on with local people.',
        },
      ],
    },
    {
      id: 's10',
      title: 'Tìm hiểu địa phương',
      subtitle: 'Dùng find out và look around khi nói về tham quan, khám phá.',
      layout: 'cards',
      cards: [
        {
          title: 'Traditions',
          accent: 'green',
          content: 'We should find out more about local traditions.',
        },
        {
          title: 'Craft village',
          accent: 'blue',
          content: 'Tourists can look around the pottery village.',
        },
        {
          title: 'Museum',
          accent: 'orange',
          content: 'Students visited the museum to find out about the history of the area.',
        },
      ],
    },
    {
      id: 's11',
      title: 'Chăm sóc cộng đồng',
      subtitle: 'Dùng look after, take care of, clean up với public places.',
      layout: 'cards',
      cards: [
        {
          title: 'Playground',
          accent: 'blue',
          content: 'We should look after the playground.',
        },
        {
          title: 'Community garden',
          accent: 'green',
          content: 'Local people take care of the community garden.',
        },
        {
          title: 'Public places',
          accent: 'orange',
          content: 'Students help clean up public places at weekends.',
        },
      ],
    },
    {
      id: 's12',
      title: 'Phrasal verbs có thể tách',
      subtitle: 'Object có thể đứng sau cả cụm hoặc giữa verb và particle.',
      layout: 'cards',
      cards: [
        {
          title: 'turn off',
          accent: 'blue',
          content: 'turn off the lights = turn the lights off',
          example: 'Please turn the lights off.',
        },
        {
          title: 'pick up',
          accent: 'green',
          content: 'pick up the rubbish = pick the rubbish up',
          example: 'Students picked the rubbish up.',
        },
        {
          title: 'Đại từ',
          accent: 'orange',
          content: 'Nếu object là it / them / him / her, đặt đại từ ở giữa.',
          example: 'Please turn it off.',
        },
      ],
    },
    {
      id: 's13',
      title: 'Phrasal verbs không thể tách',
      subtitle: 'Object phải đứng sau cả cụm động từ.',
      layout: 'cards',
      cards: [
        {
          title: 'get on with',
          accent: 'blue',
          content: 'Đúng: I get on with my neighbours.',
          example: 'Sai: I get my neighbours on with.',
        },
        {
          title: 'look after',
          accent: 'green',
          content: 'Đúng: We looked after the children.',
          example: 'Sai: We looked the children after.',
        },
        {
          title: 'take care of',
          accent: 'orange',
          content: 'Đúng: We take care of the community garden.',
          example: 'Sai: We take the garden care of.',
        },
      ],
    },
    {
      id: 's14',
      title: 'Không dịch từng từ',
      subtitle: 'Nhiều phrasal verbs có nghĩa riêng, không bằng tổng nghĩa từng từ.',
      layout: 'cards',
      cards: [
        {
          title: 'find out',
          accent: 'blue',
          content: 'Không phải “tìm + ra ngoài”.',
          example: 'find out = tìm hiểu / phát hiện ra',
        },
        {
          title: 'get on with',
          accent: 'green',
          content: 'Không phải “lấy lên với”.',
          example: 'get on with = hòa thuận với',
        },
        {
          title: 'look after',
          accent: 'orange',
          content: 'Không phải “nhìn sau”.',
          example: 'look after = chăm sóc / giữ gìn',
        },
      ],
    },
    {
      id: 's15',
      title: 'Chú ý particle',
      subtitle: 'Một động từ có thể đi với nhiều particle và đổi nghĩa.',
      layout: 'cards',
      cards: [
        {
          title: 'look after',
          accent: 'green',
          content: 'chăm sóc',
          example: 'I look after my little brother.',
        },
        {
          title: 'look for',
          accent: 'blue',
          content: 'tìm kiếm',
          example: 'I look for information about my community.',
        },
        {
          title: 'look around',
          accent: 'orange',
          content: 'tham quan / nhìn quanh',
          example: 'Tourists look around the village.',
        },
        {
          title: 'look up',
          accent: 'purple',
          content: 'tra cứu',
          example: 'I look up new words in a dictionary.',
        },
      ],
    },
    {
      id: 's16',
      title: 'Lỗi thường gặp với phrasal verbs',
      subtitle: 'Sai particle sẽ làm đổi nghĩa hoặc sai câu.',
      layout: 'cards',
      cards: [
        {
          title: 'get on with',
          accent: 'red',
          content: 'Sai: I get on to my neighbours.',
          example: 'Đúng: I get on with my neighbours.',
        },
        {
          title: 'look after',
          accent: 'red',
          content: 'Sai: We look for the park carefully.',
          example: 'Đúng: We look after the park carefully.',
        },
        {
          title: 'turn off',
          accent: 'orange',
          content: 'Sai: Please turn off it.',
          example: 'Đúng: Please turn it off.',
        },
      ],
    },
    {
      id: 's17',
      title: 'Ví dụ phân tích',
      subtitle: 'Phrasal verbs trong câu hoàn chỉnh.',
      layout: 'cards',
      cards: [
        {
          title: 'look after',
          accent: 'blue',
          content: 'We should look after the public facilities in our community.',
          example: 'Nói về trách nhiệm giữ gìn cơ sở vật chất công cộng.',
        },
        {
          title: 'get on with',
          accent: 'green',
          content: 'I get on well with my neighbours.',
          example: 'Nói về quan hệ với hàng xóm.',
        },
        {
          title: 'look around',
          accent: 'orange',
          content: 'Tourists looked around the craft village.',
          example: 'Nói về hoạt động tham quan làng nghề.',
        },
      ],
    },
    {
      id: 's18',
      title: 'Luyện tập: Phrasal verbs',
      subtitle: 'Chọn cụm đúng để hoàn thành câu.',
      layout: 'practice',
      accent: 'blue',
      sections: [
        {
          title: 'Câu 1',
          content: 'We should _____ the playground in our neighbourhood.',
          example: 'look after / take care of',
        },
        {
          title: 'Câu 2',
          content: 'Tourists can _____ the pottery village on Sundays.',
          example: 'look around',
        },
        {
          title: 'Câu 3',
          content: 'The students want to _____ about the history of the local museum.',
          example: 'find out',
        },
      ],
    },
    {
      id: 's19',
      title: 'Phần 2',
      subtitle: 'Question Words Before To-infinitives',
      layout: 'section-cover',
      accent: 'green',
    },
    {
      id: 's20',
      title: 'Question word + to V là gì?',
      subtitle: 'Từ để hỏi đứng trước to + động từ nguyên mẫu.',
      layout: 'explain',
      accent: 'green',
      formula: 'Question word + to + V nguyên mẫu',
      bullets: [
        {
          content: 'Dùng để nói điều không biết, muốn biết, cần quyết định hoặc cần được chỉ dẫn.',
        },
        { content: 'Các từ thường dùng: what, where, when, how, who, which.' },
        {
          content:
            'Trong Unit 1, cấu trúc này thường dùng khi hỏi đường, chọn nơi tham quan hoặc mua sản phẩm địa phương.',
        },
      ],
      examples: [
        'I don’t know where to buy traditional handicrafts.',
        'Can you tell me how to get to the museum?',
        'We need to decide what to do for the community project.',
      ],
    },
    {
      id: 's21',
      title: 'Bảng nghĩa nhanh',
      subtitle: 'Mỗi question word trả lời một loại thông tin.',
      layout: 'cards',
      cards: [
        {
          title: 'what to V',
          accent: 'blue',
          content: 'làm gì',
          example: 'what to do',
        },
        {
          title: 'where to V',
          accent: 'green',
          content: 'đi đâu / làm ở đâu',
          example: 'where to go',
        },
        {
          title: 'when to V',
          accent: 'orange',
          content: 'khi nào làm',
          example: 'when to start',
        },
        {
          title: 'how to V',
          accent: 'purple',
          content: 'làm như thế nào',
          example: 'how to get there',
        },
      ],
    },
    {
      id: 's22',
      title: 'Who to V và Which to V',
      subtitle: 'Dùng khi cần chọn người hoặc chọn một trong nhiều lựa chọn.',
      layout: 'cards',
      cards: [
        {
          title: 'who to V',
          accent: 'blue',
          content: 'hỏi ai / gặp ai / liên hệ ai',
          example: 'I don’t know who to ask for help.',
        },
        {
          title: 'which to V',
          accent: 'green',
          content: 'chọn cái nào',
          example: 'She asked which bus to take to the museum.',
        },
        {
          title: 'Ghi nhớ',
          accent: 'orange',
          content: 'Why to V không phổ biến trong cấu trúc này.',
          example: 'I don’t know why I should do it.',
        },
      ],
    },
    {
      id: 's23',
      title: 'Sau know / don’t know',
      subtitle: 'Dùng khi biết hoặc không biết thông tin cần làm.',
      layout: 'explain',
      accent: 'green',
      formula: 'S + know / don’t know + question word + to V',
      bullets: [
        { content: 'Dùng để nói khả năng biết địa điểm, cách làm, thời gian hoặc người cần hỏi.' },
        { content: 'Sau question word là to + V, không có chủ ngữ.' },
      ],
      examples: [
        'I don’t know where to go in this neighbourhood.',
        'She knows how to make pottery.',
        'We don’t know who to ask for directions.',
      ],
    },
    {
      id: 's24',
      title: 'Sau decide',
      subtitle: 'Dùng khi cần quyết định làm gì, đi đâu, chọn cái nào.',
      layout: 'explain',
      accent: 'blue',
      formula: 'S + decide + question word + to V',
      bullets: [
        { content: 'Decide thường đi với what / where / when / how / which.' },
        { content: 'Có thể dùng dạng phủ định hoặc couldn’t decide.' },
      ],
      examples: [
        'We decided where to meet.',
        'They decided what to buy at the market.',
        'She couldn’t decide which souvenir to choose.',
      ],
    },
    {
      id: 's25',
      title: 'Sau ask / tell / show / explain',
      subtitle: 'Dùng để hỏi hoặc chỉ dẫn cho ai đó cách làm gì.',
      layout: 'explain',
      accent: 'orange',
      formula: 'S + ask / tell / show / explain + object + question word + to V',
      bullets: [
        { content: 'Object thường là me, us, tourists, students.' },
        { content: 'How to V rất phổ biến khi hỏi đường hoặc hướng dẫn cách làm.' },
        { content: 'Where to V dùng khi chỉ nơi mua, đi hoặc tìm địa điểm.' },
      ],
      examples: [
        'Can you tell me how to get to the nearest bus stop?',
        'The guide showed us where to buy local products.',
        'My teacher explained how to complete the community project.',
      ],
    },
    {
      id: 's26',
      title: 'What to V',
      subtitle: 'Dùng khi muốn nói làm gì.',
      layout: 'cards',
      cards: [
        {
          title: 'Weekend',
          accent: 'blue',
          content: 'I don’t know what to do this weekend.',
        },
        {
          title: 'Festival',
          accent: 'green',
          content: 'We should decide what to prepare for the local festival.',
        },
        {
          title: 'Project',
          accent: 'orange',
          content: 'The students discussed what to do to improve the playground.',
        },
      ],
    },
    {
      id: 's27',
      title: 'Where to V',
      subtitle: 'Dùng khi muốn nói địa điểm.',
      layout: 'cards',
      cards: [
        {
          title: 'Pottery',
          accent: 'green',
          content: 'Can you tell me where to buy pottery?',
        },
        {
          title: 'Community centre',
          accent: 'blue',
          content: 'I don’t know where to find the community centre.',
        },
        {
          title: 'Local food',
          accent: 'orange',
          content: 'Tourists asked where to try local food.',
        },
      ],
    },
    {
      id: 's28',
      title: 'When / How to V',
      subtitle: 'Dùng để hỏi thời gian hoặc cách làm.',
      layout: 'cards',
      cards: [
        {
          title: 'When',
          accent: 'blue',
          content: 'We need to know when to start the project.',
        },
        {
          title: 'When',
          accent: 'green',
          content: 'They decided when to hold the community meeting.',
        },
        {
          title: 'How',
          accent: 'orange',
          content: 'Can you show me how to get to the stadium?',
        },
        {
          title: 'How',
          accent: 'purple',
          content: 'Students learned how to protect public facilities.',
        },
      ],
    },
    {
      id: 's29',
      title: 'Who / Which to V',
      subtitle: 'Dùng khi cần hỏi người hoặc chọn một lựa chọn.',
      layout: 'cards',
      cards: [
        {
          title: 'Who',
          accent: 'blue',
          content: 'I don’t know who to ask for help.',
        },
        {
          title: 'Who',
          accent: 'green',
          content: 'She knows who to contact about the community event.',
        },
        {
          title: 'Which',
          accent: 'orange',
          content: 'I don’t know which souvenir to buy.',
        },
        {
          title: 'Which',
          accent: 'purple',
          content: 'They couldn’t decide which place to visit first.',
        },
      ],
    },
    {
      id: 's30',
      title: 'Cách viết lại câu',
      subtitle: 'Question word + to V có thể rút gọn từ mệnh đề có should / can / could.',
      layout: 'cards',
      cards: [
        {
          title: 'Where',
          accent: 'green',
          content: 'I don’t know where I should go.',
          example: 'I don’t know where to go.',
        },
        {
          title: 'How',
          accent: 'blue',
          content: 'Can you tell me how I can get to the museum?',
          example: 'Can you tell me how to get to the museum?',
        },
        {
          title: 'What',
          accent: 'orange',
          content: 'We haven’t decided what we should do.',
          example: 'We haven’t decided what to do.',
        },
      ],
    },
    {
      id: 's31',
      title: 'Lỗi cần tránh',
      subtitle: 'Sau question word dùng to + V nguyên mẫu.',
      layout: 'cards',
      cards: [
        {
          title: 'where to go',
          accent: 'red',
          content: 'Sai: I don’t know where going.',
          example: 'Đúng: I don’t know where to go.',
        },
        {
          title: 'how to get',
          accent: 'red',
          content: 'Sai: She asked how getting there.',
          example: 'Đúng: She asked how to get there.',
        },
        {
          title: 'Không có chủ ngữ',
          accent: 'orange',
          content: 'Sai: I don’t know where I to go.',
          example: 'Đúng: I don’t know where to go.',
        },
      ],
    },
    {
      id: 's32',
      title: 'Luyện tập: Question word + to V',
      subtitle: 'Hoàn thành câu bằng cấu trúc phù hợp.',
      layout: 'practice',
      accent: 'green',
      sections: [
        {
          title: 'Câu 1',
          content: 'Can you tell me _____ to get to the museum?',
          example: 'how',
        },
        {
          title: 'Câu 2',
          content: 'Tourists asked _____ to buy traditional handicrafts.',
          example: 'where',
        },
        {
          title: 'Câu 3',
          content: 'We haven’t decided _____ to do for the community project.',
          example: 'what',
        },
      ],
    },
    {
      id: 's33',
      title: 'Từ vựng: Địa điểm trong cộng đồng',
      subtitle: 'Các địa điểm thường gặp trong Local Community.',
      layout: 'cards',
      cards: [
        {
          title: 'Community places',
          accent: 'blue',
          content: 'local community, neighbourhood, suburb, village, commune',
          example: 'My neighbourhood is quiet and friendly.',
        },
        {
          title: 'Public facilities',
          accent: 'green',
          content: 'community centre, playground, stadium, museum, market',
          example: 'The meeting is at the community centre.',
        },
        {
          title: 'Useful question',
          accent: 'orange',
          content: 'Can you tell me how to get to the community centre?',
        },
      ],
    },
    {
      id: 's34',
      title: 'Từ vựng: Sản phẩm và nghề truyền thống',
      subtitle: 'Dùng khi nói về craft villages và local products.',
      layout: 'cards',
      cards: [
        {
          title: 'Products',
          accent: 'green',
          content: 'handicraft, pottery, product, souvenir',
          example: 'Tourists like buying handicrafts.',
        },
        {
          title: 'Craft village',
          accent: 'blue',
          content: 'craft village, clay, bamboo, traditional craft',
          example: 'This village is famous for pottery.',
        },
        {
          title: 'Useful question',
          accent: 'orange',
          content: 'Do you know where to buy pottery in this village?',
        },
      ],
    },
    {
      id: 's35',
      title: 'Từ vựng: Con người và hoạt động cộng đồng',
      subtitle: 'Dùng với phrasal verbs và question word + to V.',
      layout: 'cards',
      cards: [
        {
          title: 'People',
          accent: 'blue',
          content: 'neighbour, resident, villager, volunteer, visitor, tourist',
          example: 'My neighbours are very helpful.',
        },
        {
          title: 'Actions',
          accent: 'green',
          content: 'move in, clean up, take care of',
          example: 'A new family moved in next door.',
        },
        {
          title: 'Community sentence',
          accent: 'orange',
          content: 'We take care of public places.',
        },
      ],
    },
    {
      id: 's36',
      title: 'Từ vựng: Tính từ miêu tả cộng đồng',
      subtitle: 'Dùng để nhận xét khu phố, làng nghề hoặc tiện ích địa phương.',
      layout: 'cards',
      cards: [
        {
          title: 'People and life',
          accent: 'green',
          content: 'local, peaceful, friendly, helpful, lively',
          example: 'The residents are friendly.',
        },
        {
          title: 'Places',
          accent: 'blue',
          content: 'crowded, modern, traditional, famous, convenient',
          example: 'The village is famous for pottery.',
        },
        {
          title: 'Useful sentence',
          accent: 'orange',
          content: 'The local market is lively.',
        },
      ],
    },
    {
      id: 's37',
      title: 'Cấu trúc giao tiếp thường gặp',
      subtitle: 'Dùng trong hỏi đường, mua sản phẩm địa phương và nói về cộng đồng.',
      layout: 'cards',
      cards: [
        {
          title: 'Hỏi đường',
          accent: 'green',
          content: 'Can you tell me how to get to + place?',
          example: 'Can you tell me how to get to the museum?',
        },
        {
          title: 'Hỏi nơi mua',
          accent: 'blue',
          content: 'Do you know where to buy + noun?',
          example: 'Do you know where to buy traditional handicrafts?',
        },
        {
          title: 'Hàng xóm',
          accent: 'orange',
          content: 'S + get on well with + neighbours / local people.',
          example: 'I get on well with my neighbours.',
        },
        {
          title: 'Tìm hiểu',
          accent: 'purple',
          content: 'S + find out about + noun.',
          example: 'We found out about the history of the village.',
        },
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
          content: 'I get on to my neighbours.',
          example: 'I get on with my neighbours.',
        },
        {
          title: 'Lỗi 2',
          content: 'Please turn off it.',
          example: 'Please turn it off.',
        },
        {
          title: 'Lỗi 3',
          content: 'I don’t know where going.',
          example: 'I don’t know where to go.',
        },
      ],
    },
    {
      id: 's39',
      title: 'Bài tập viết câu',
      subtitle: 'Dùng phrasal verbs hoặc question word + to V.',
      layout: 'practice',
      accent: 'blue',
      sections: [
        {
          title: 'Câu 1',
          content: 'Viết câu với look after và public facilities.',
          example: 'We should look after public facilities in our community.',
        },
        {
          title: 'Câu 2',
          content: 'Viết câu hỏi cách đi đến community centre.',
          example: 'Can you tell me how to get to the community centre?',
        },
        {
          title: 'Câu 3',
          content: 'Viết câu với find out about local traditions.',
          example: 'Students should find out about local traditions.',
        },
      ],
    },
    {
      id: 's40',
      title: 'Tổng kết Unit 1',
      subtitle: 'Local Community',
      layout: 'practice',
      accent: 'green',
      sections: [
        {
          title: 'Phrasal verbs',
          content:
            'Verb + particle: get on with, look around, find out, look after, move in, set up.',
          example: 'I get on well with my neighbours.',
        },
        {
          title: 'Question word + to V',
          content: 'what / where / when / how / who / which + to + V nguyên mẫu.',
          example: 'I don’t know where to buy traditional handicrafts.',
        },
        {
          title: 'Ứng dụng',
          content:
            'Dùng để hỏi đường, tìm hiểu cộng đồng, chọn nơi tham quan và nói về hoạt động địa phương.',
          example: 'Can you show me how to get to the stadium?',
        },
      ],
    },
  ],
};

export default deck;
