import { LessonDeck } from '../../../types';

const deck: LessonDeck = {
  id: 'gs-g9-u8-tourism',
  curriculumFamily: 'global-success',
  grade: 9,
  unitNumber: 8,
  title: 'Grammar Grade 9 - Unit 8: Tourism',
  description:
    'Bài giảng Unit 8 Global Success 9 về relative pronouns who, whom, which, whose và từ vựng Tourism.',
  createdAt: '2026-05-18T00:00:00.000Z',
  slides: [
    {
      id: 's1',
      title: 'GRAMMAR GRADE 9',
      subtitle: 'UNIT 8: TOURISM',
      label: 'NỘI DUNG BÀI HỌC:',
      layout: 'outline',
      cards: [
        {
          title: 'WHO, WHOM, WHICH',
          subtitle: '(Đại từ quan hệ: who, whom, which)',
          accent: 'blue',
        },
        {
          title: 'WHOSE',
          subtitle: '(Đại từ quan hệ chỉ sở hữu)',
          accent: 'orange',
        },
        {
          title: 'TOURISM VOCABULARY',
          subtitle: '(Từ vựng du lịch)',
          accent: 'green',
        },
      ],
    },
    {
      id: 's2',
      title: 'Mục tiêu bài học',
      layout: 'objectives',
      bullets: [
        { content: 'Dùng who cho người làm chủ ngữ trong mệnh đề quan hệ.' },
        { content: 'Dùng whom cho người làm tân ngữ trong mệnh đề quan hệ.' },
        { content: 'Dùng which cho vật, địa điểm, sự việc hoặc trải nghiệm du lịch.' },
        { content: 'Dùng whose để chỉ sự sở hữu và nối câu đúng trong chủ đề Tourism.' },
      ],
    },
    {
      id: 's3',
      title: 'Phần 1',
      subtitle: 'Who, Whom, Which',
      layout: 'section-cover',
      accent: 'blue',
    },
    {
      id: 's4',
      title: 'Relative pronouns là gì?',
      subtitle: 'Who, whom, which dùng để nối hai câu hoặc hai mệnh đề.',
      layout: 'explain',
      accent: 'blue',
      formula: 'Noun + relative pronoun + relative clause',
      bullets: [
        { content: 'Đại từ quan hệ đứng sau danh từ cần bổ sung thông tin.' },
        { content: 'Who và whom dùng cho người.' },
        { content: 'Which dùng cho vật, địa điểm, sự việc hoặc con vật.' },
      ],
      examples: [
        'The tour guide who helped us was very friendly.',
        'The tourist whom we met at the airport was from Canada.',
        'The hotel which is near the beach is very expensive.',
      ],
    },
    {
      id: 's5',
      title: 'Relative clause trong câu du lịch',
      subtitle: 'Mệnh đề quan hệ bổ sung thông tin cho danh từ đứng trước.',
      layout: 'cards',
      cards: [
        {
          title: 'Câu gốc 1',
          accent: 'blue',
          content: 'The hotel is very modern.',
        },
        {
          title: 'Câu gốc 2',
          accent: 'green',
          content: 'It is near the beach.',
        },
        {
          title: 'Câu nối',
          accent: 'purple',
          content: 'The hotel which is near the beach is very modern.',
        },
        {
          title: 'Phân tích',
          accent: 'orange',
          content: 'Which thay cho the hotel và đứng đầu mệnh đề quan hệ.',
        },
      ],
    },
    {
      id: 's6',
      title: 'Who',
      subtitle: 'Who thay thế cho người và thường làm chủ ngữ.',
      layout: 'explain',
      accent: 'blue',
      formula: 'Person + who + V + ...',
      bullets: [
        { content: 'Sau who thường là động từ.' },
        { content: 'Who thay cho tourist, guide, man, woman, receptionist...' },
        { content: 'Dùng khi người đó thực hiện hành động trong mệnh đề quan hệ.' },
      ],
      examples: [
        'The tourist who took photos was very excited.',
        'The guide who showed us around spoke English well.',
        'The woman who works at the hotel is very helpful.',
      ],
    },
    {
      id: 's7',
      title: 'Nối câu với Who',
      subtitle: 'Dùng who để thay cho he / she / they chỉ người.',
      layout: 'practice',
      accent: 'blue',
      sections: [
        {
          title: 'Ví dụ 1',
          content: 'The guide was friendly. He helped us yesterday.',
          example: 'The guide who helped us yesterday was friendly.',
        },
        {
          title: 'Ví dụ 2',
          content: 'The tourists were from Australia. They visited Ha Long Bay.',
          example: 'The tourists who visited Ha Long Bay were from Australia.',
        },
      ],
    },
    {
      id: 's8',
      title: 'Whom',
      subtitle: 'Whom thay thế cho người nhưng làm tân ngữ trong mệnh đề quan hệ.',
      layout: 'explain',
      accent: 'purple',
      formula: 'Person + whom + S + V + ...',
      bullets: [
        { content: 'Sau whom thường có một chủ ngữ khác như we, I, they.' },
        { content: 'Whom dùng trang trọng hơn who.' },
        { content: 'Trong bài ngữ pháp lớp 9, dùng whom khi đại từ quan hệ là tân ngữ chỉ người.' },
      ],
      examples: [
        'The tourist whom we met was very kind.',
        'The guide whom they hired spoke three languages.',
        'The man whom we talked to gave us useful advice.',
      ],
    },
    {
      id: 's9',
      title: 'Nối câu với Whom',
      subtitle: 'Dùng whom để thay cho him / her / them chỉ người.',
      layout: 'practice',
      accent: 'purple',
      sections: [
        {
          title: 'Ví dụ 1',
          content: 'The tourist was friendly. We met him at the airport.',
          example: 'The tourist whom we met at the airport was friendly.',
        },
        {
          title: 'Ví dụ 2',
          content: 'The guide was helpful. We hired him for the trip.',
          example: 'The guide whom we hired for the trip was helpful.',
        },
        {
          title: 'Văn nói',
          content: 'Người bản xứ thường dùng who thay cho whom trong giao tiếp.',
          example: 'The tourist who we met was friendly.',
        },
      ],
    },
    {
      id: 's10',
      title: 'Which',
      subtitle: 'Which thay thế cho vật, sự việc, địa điểm hoặc con vật.',
      layout: 'explain',
      accent: 'green',
      formula: 'Thing / place + which + V / S + V + ...',
      bullets: [
        { content: 'Which có thể làm chủ ngữ trong mệnh đề quan hệ.' },
        { content: 'Which cũng có thể làm tân ngữ khi sau nó có chủ ngữ khác.' },
        {
          content:
            'Trong Tourism, which thường dùng với hotel, city, tour, restaurant, beach, suitcase.',
        },
      ],
      examples: [
        'The hotel which overlooks the sea is very beautiful.',
        'The suitcase which I bought yesterday is very light.',
        'The city which we visited was amazing.',
      ],
    },
    {
      id: 's11',
      title: 'Which làm chủ ngữ',
      subtitle: 'Sau which là động từ của mệnh đề quan hệ.',
      layout: 'cards',
      cards: [
        {
          title: 'Hotel',
          accent: 'green',
          content: 'The hotel which overlooks the sea is very beautiful.',
        },
        {
          title: 'Bus',
          accent: 'blue',
          content: 'The bus which goes to the airport leaves at 7 a.m.',
        },
        {
          title: 'Restaurant',
          accent: 'orange',
          content: 'The restaurant which serves local food is very popular.',
        },
        {
          title: 'Package tour',
          accent: 'purple',
          content: 'The package tour which includes meals is expensive.',
        },
      ],
    },
    {
      id: 's12',
      title: 'Which làm tân ngữ',
      subtitle: 'Sau which có chủ ngữ riêng như I, we, they.',
      layout: 'cards',
      cards: [
        {
          title: 'Suitcase',
          accent: 'green',
          content: 'The suitcase which I bought yesterday is very light.',
        },
        {
          title: 'City',
          accent: 'blue',
          content: 'The city which we visited was amazing.',
        },
        {
          title: 'Meal',
          accent: 'orange',
          content: 'The meal which they served was delicious.',
        },
        {
          title: 'Beach',
          accent: 'purple',
          content: 'The beach which we saw in the video looked peaceful.',
        },
      ],
    },
    {
      id: 's13',
      title: 'Nối câu với Which',
      subtitle: 'Dùng which để thay thế it / them chỉ vật hoặc sự việc.',
      layout: 'practice',
      accent: 'green',
      sections: [
        {
          title: 'Ví dụ 1',
          content: 'The hotel is near the beach. It is very expensive.',
          example: 'The hotel which is near the beach is very expensive.',
        },
        {
          title: 'Ví dụ 2',
          content: 'The tour was interesting. We joined it last summer.',
          example: 'The tour which we joined last summer was interesting.',
        },
        {
          title: 'Ví dụ 3',
          content: 'The restaurant serves local food. It is near the market.',
          example: 'The restaurant which serves local food is near the market.',
        },
      ],
    },
    {
      id: 's14',
      title: 'Who / Whom / Which',
      subtitle: 'Nhìn danh từ và vai trò trong mệnh đề để chọn đúng.',
      layout: 'cards',
      cards: [
        {
          title: 'Who',
          accent: 'blue',
          content: 'Người, làm chủ ngữ.',
          example: 'The guide who helped us was friendly.',
        },
        {
          title: 'Whom',
          accent: 'purple',
          content: 'Người, làm tân ngữ.',
          example: 'The tourist whom we met was kind.',
        },
        {
          title: 'Which',
          accent: 'green',
          content: 'Vật / địa điểm / sự việc, làm chủ ngữ hoặc tân ngữ.',
          example: 'The hotel which is near the beach is expensive.',
        },
      ],
    },
    {
      id: 's15',
      title: 'Lỗi cần tránh',
      subtitle: 'Không dùng who cho vật hoặc which cho người.',
      layout: 'cards',
      cards: [
        {
          title: 'Hotel',
          accent: 'red',
          content: 'Sai: The hotel who is near the beach is expensive.',
          example: 'Đúng: The hotel which is near the beach is expensive.',
        },
        {
          title: 'Guide',
          accent: 'red',
          content: 'Sai: The guide which helped us was friendly.',
          example: 'Đúng: The guide who helped us was friendly.',
        },
        {
          title: 'No repeated pronoun',
          accent: 'orange',
          content: 'Sai: The hotel which we stayed in it was modern.',
          example: 'Đúng: The hotel which we stayed in was modern.',
        },
      ],
    },
    {
      id: 's16',
      title: 'Ví dụ minh họa chi tiết',
      subtitle: 'Phân tích vai trò của who, whom, which.',
      layout: 'cards',
      cards: [
        {
          title: 'Who',
          accent: 'blue',
          content: 'The tour guide who showed us around was very friendly.',
          example: 'Who làm chủ ngữ của showed.',
        },
        {
          title: 'Whom',
          accent: 'purple',
          content: 'The tourist whom we met at the airport was from Canada.',
          example: 'Whom làm tân ngữ của met.',
        },
        {
          title: 'Which',
          accent: 'green',
          content: 'The city which we visited last year was beautiful.',
          example: 'Which thay cho the city và làm tân ngữ của visited.',
        },
      ],
    },
    {
      id: 's17',
      title: 'Phần 2',
      subtitle: 'Whose',
      layout: 'section-cover',
      accent: 'orange',
    },
    {
      id: 's18',
      title: 'Whose là gì?',
      subtitle: 'Whose là đại từ quan hệ chỉ sự sở hữu.',
      layout: 'explain',
      accent: 'orange',
      formula: 'Noun + whose + noun + V + ...',
      bullets: [
        { content: 'Whose có nghĩa là của ai / của cái gì.' },
        { content: 'Sau whose luôn có danh từ.' },
        {
          content:
            'Trong Tourism, whose thường dùng với passport, suitcase, camera, rooms, service.',
        },
      ],
      examples: [
        'The tourist whose passport was lost went to the police station.',
        'The woman whose camera was broken asked for help.',
        'The hotel whose rooms face the sea is very popular.',
      ],
    },
    {
      id: 's19',
      title: 'Whose với người',
      subtitle: 'Dùng whose để nói đồ vật, đặc điểm hoặc người thân thuộc về ai.',
      layout: 'cards',
      cards: [
        {
          title: 'Bag',
          accent: 'orange',
          content: 'The man whose bag was stolen reported it to the police.',
        },
        {
          title: 'Ticket',
          accent: 'blue',
          content: 'The tourist whose ticket was lost could not board the plane.',
        },
        {
          title: 'Son',
          accent: 'green',
          content: 'The woman whose son was sick cancelled the trip.',
        },
        {
          title: 'Knowledge',
          accent: 'purple',
          content: 'The guide whose knowledge was excellent impressed the tourists.',
        },
      ],
    },
    {
      id: 's20',
      title: 'Whose với vật / địa điểm',
      subtitle: 'Whose cũng có thể dùng cho địa điểm hoặc sự vật trong văn viết.',
      layout: 'cards',
      cards: [
        {
          title: 'Hotel',
          accent: 'orange',
          content: 'The hotel whose rooms are comfortable is fully booked.',
        },
        {
          title: 'City',
          accent: 'blue',
          content: 'The city whose streets are crowded attracts many tourists.',
        },
        {
          title: 'Restaurant',
          accent: 'green',
          content: 'The restaurant whose food is famous is near the beach.',
        },
        {
          title: 'Island',
          accent: 'purple',
          content: 'The island whose beaches are clean is perfect for a holiday.',
        },
      ],
    },
    {
      id: 's21',
      title: 'Nối câu với Whose',
      subtitle: 'Dùng whose để thay cho his / her / its + noun.',
      layout: 'practice',
      accent: 'orange',
      sections: [
        {
          title: 'Ví dụ 1',
          content: 'The tourist was worried. His passport was lost.',
          example: 'The tourist whose passport was lost was worried.',
        },
        {
          title: 'Ví dụ 2',
          content: 'The woman asked for help. Her suitcase was missing.',
          example: 'The woman whose suitcase was missing asked for help.',
        },
        {
          title: 'Ví dụ 3',
          content: 'The hotel is popular. Its rooms face the sea.',
          example: 'The hotel whose rooms face the sea is popular.',
        },
      ],
    },
    {
      id: 's22',
      title: 'Who / Whom / Which / Whose',
      subtitle: 'Bảng phân biệt nhanh.',
      layout: 'cards',
      cards: [
        {
          title: 'Who',
          accent: 'blue',
          content: 'Người, làm chủ ngữ.',
          example: 'The guide who helped us was kind.',
        },
        {
          title: 'Whom',
          accent: 'purple',
          content: 'Người, làm tân ngữ.',
          example: 'The tourist whom we met was friendly.',
        },
        {
          title: 'Which',
          accent: 'green',
          content: 'Vật / địa điểm / sự việc.',
          example: 'The hotel which is near the beach is modern.',
        },
        {
          title: 'Whose',
          accent: 'orange',
          content: 'Chỉ sở hữu.',
          example: 'The tourist whose bag was lost was worried.',
        },
      ],
    },
    {
      id: 's23',
      title: 'Lỗi với Whose',
      subtitle: 'Sau whose luôn có danh từ và không dùng thêm his / her / its.',
      layout: 'cards',
      cards: [
        {
          title: 'Thiếu danh từ',
          accent: 'red',
          content: 'Sai: The tourist whose was lost was worried.',
          example: 'Đúng: The tourist whose passport was lost was worried.',
        },
        {
          title: 'Dùng his sau whose',
          accent: 'red',
          content: 'Sai: The tourist whose his passport was lost was worried.',
          example: 'Đúng: The tourist whose passport was lost was worried.',
        },
        {
          title: 'Dùng its sau whose',
          accent: 'red',
          content: 'Sai: The hotel whose its rooms are clean is popular.',
          example: 'Đúng: The hotel whose rooms are clean is popular.',
        },
      ],
    },
    {
      id: 's24',
      title: 'Ví dụ minh họa Whose',
      subtitle: 'Whose giúp gộp thông tin sở hữu vào một câu.',
      layout: 'cards',
      cards: [
        {
          title: 'Passport',
          accent: 'orange',
          content: 'The tourist whose passport was lost looked worried.',
          example: 'Whose passport = hộ chiếu của du khách đó.',
        },
        {
          title: 'Hotel rooms',
          accent: 'blue',
          content: 'The hotel whose rooms face the sea is very expensive.',
          example: 'Whose rooms = các phòng của khách sạn đó.',
        },
        {
          title: 'Guide knowledge',
          accent: 'green',
          content: 'The guide whose knowledge of local culture was excellent impressed us.',
          example: 'Whose knowledge = kiến thức của hướng dẫn viên đó.',
        },
      ],
    },
    {
      id: 's25',
      title: 'Từ vựng: Người liên quan đến du lịch',
      subtitle: 'Các danh từ chỉ người thường đi với who / whom / whose.',
      layout: 'cards',
      cards: [
        {
          title: 'Travellers',
          accent: 'blue',
          content: 'tourist, visitor, traveller, backpacker, passenger',
          example: 'The tourist who took photos was excited.',
        },
        {
          title: 'Service people',
          accent: 'green',
          content: 'tour guide, receptionist, travel agent',
          example: 'The receptionist who checked us in was polite.',
        },
        {
          title: 'Possession',
          accent: 'orange',
          content: 'The traveller whose phone was lost asked for help.',
        },
      ],
    },
    {
      id: 's26',
      title: 'Từ vựng: Địa điểm du lịch',
      subtitle: 'Các địa điểm thường đi với which hoặc whose.',
      layout: 'cards',
      cards: [
        {
          title: 'Places to stay',
          accent: 'green',
          content: 'hotel, resort, homestay',
          example: 'The hotel whose rooms are clean is popular.',
        },
        {
          title: 'Attractions',
          accent: 'blue',
          content: 'tourist attraction, destination, museum, beach, landmark',
          example: 'The museum which we visited was interesting.',
        },
        {
          title: 'Transport places',
          accent: 'purple',
          content: 'airport, railway station',
          example: 'The station which is downtown is very busy.',
        },
      ],
    },
    {
      id: 's27',
      title: 'Từ vựng: Hoạt động và đồ vật du lịch',
      subtitle: 'Cụm từ thường dùng trong câu relative clauses.',
      layout: 'cards',
      cards: [
        {
          title: 'Activities',
          accent: 'blue',
          content: 'book a tour, check in, check out, go sightseeing, take photos, buy souvenirs',
          example: 'The tourist who took photos was excited.',
        },
        {
          title: 'Experiences',
          accent: 'green',
          content: 'visit a museum, explore a city, try local food, join a package tour',
          example: 'The tour which we joined was interesting.',
        },
        {
          title: 'Travel items',
          accent: 'orange',
          content: 'passport, ticket, suitcase, luggage, camera, map, backpack, boarding pass',
          example: 'The passenger whose ticket was missing was worried.',
        },
      ],
    },
    {
      id: 's28',
      title: 'Từ vựng: Tính từ miêu tả du lịch',
      subtitle: 'Dùng để nhận xét địa điểm, chuyến đi hoặc khách sạn.',
      layout: 'cards',
      cards: [
        {
          title: 'Positive',
          accent: 'green',
          content: 'popular, famous, peaceful, beautiful, exciting, convenient, comfortable',
          example: 'Hoi An is a popular destination.',
        },
        {
          title: 'Cost',
          accent: 'blue',
          content: 'expensive, affordable',
          example: 'The homestay was affordable.',
        },
        {
          title: 'Crowd and culture',
          accent: 'orange',
          content: 'crowded, local',
          example: 'We tried local food.',
        },
      ],
    },
    {
      id: 's29',
      title: 'Cấu trúc giao tiếp thường gặp',
      subtitle: 'Dùng relative pronouns để miêu tả trải nghiệm du lịch.',
      layout: 'cards',
      cards: [
        {
          title: 'Person + who',
          accent: 'blue',
          content: 'The guide who helped us was friendly.',
        },
        {
          title: 'Person + whom',
          accent: 'purple',
          content: 'The tourist whom we met was from Australia.',
        },
        {
          title: 'Thing / Place + which',
          accent: 'green',
          content: 'The city which we visited was beautiful.',
        },
        {
          title: 'Noun + whose',
          accent: 'orange',
          content: 'The hotel whose rooms face the sea is popular.',
        },
      ],
    },
    {
      id: 's30',
      title: 'Bài tập mẫu',
      subtitle: 'Chọn who, whom, which hoặc whose.',
      layout: 'practice',
      accent: 'blue',
      sections: [
        {
          title: 'Bài 1',
          content: 'The guide _____ showed us around was very friendly.',
          example: 'who',
        },
        {
          title: 'Bài 2',
          content: 'The tourist _____ we met at the airport was from Canada.',
          example: 'whom',
        },
        {
          title: 'Bài 3',
          content: 'The woman _____ passport was lost went to the police station.',
          example: 'whose',
        },
      ],
    },
    {
      id: 's31',
      title: 'Nối câu',
      subtitle: 'Dùng đại từ quan hệ phù hợp.',
      layout: 'practice',
      accent: 'green',
      sections: [
        {
          title: 'Câu 1',
          content: 'The guide was helpful. He spoke English well.',
          example: 'The guide who spoke English well was helpful.',
        },
        {
          title: 'Câu 2',
          content: 'The hotel was modern. It had a sea view.',
          example: 'The hotel which had a sea view was modern.',
        },
        {
          title: 'Câu 3',
          content: 'The woman was worried. Her camera was broken.',
          example: 'The woman whose camera was broken was worried.',
        },
      ],
    },
    {
      id: 's32',
      title: 'Sửa lỗi sai',
      subtitle: 'Tìm lỗi và viết lại câu đúng.',
      layout: 'practice',
      accent: 'red',
      sections: [
        {
          title: 'Lỗi 1',
          content: 'The hotel who is near the beach is expensive.',
          example: 'The hotel which is near the beach is expensive.',
        },
        {
          title: 'Lỗi 2',
          content: 'The woman whom took photos was from England.',
          example: 'The woman who took photos was from England.',
        },
        {
          title: 'Lỗi 3',
          content: 'The city which we visited it was beautiful.',
          example: 'The city which we visited was beautiful.',
        },
      ],
    },
    {
      id: 's33',
      title: 'Tổng kết Unit 8',
      subtitle: 'Tourism',
      layout: 'practice',
      accent: 'orange',
      sections: [
        {
          title: 'Who',
          content: 'Person + who + V',
          example: 'The guide who helped us was friendly.',
        },
        {
          title: 'Whom',
          content: 'Person + whom + S + V',
          example: 'The tourist whom we met was kind.',
        },
        {
          title: 'Which / Whose',
          content: 'Thing / place + which + V / S + V; noun + whose + noun + V',
          example: 'The hotel whose rooms are clean is popular.',
        },
      ],
    },
  ],
};

export default deck;
