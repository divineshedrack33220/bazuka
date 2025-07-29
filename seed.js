const mongoose = require('mongoose');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

// Set Mongoose strictQuery
mongoose.set('strictQuery', true);

// Import models
let Product, Category, Testimonial, Promo, Newsletter;
try {
  Product = require('./models/Product');
  Category = require('./models/Category');
  Testimonial = require('./models/Testimonial');
  Promo = require('./models/Promo');
  Newsletter = require('./models/Newsletter');
} catch (error) {
  console.error('Error loading models:', error.message);
  process.exit(1);
}

// Debug: Verify models
const models = { Product, Category, Testimonial, Promo, Newsletter };
for (const [name, model] of Object.entries(models)) {
  console.log(`${name} model:`, model ? 'Loaded' : 'Not loaded');
  if (model && typeof model.deleteMany !== 'function') {
    console.error(`${name} is not a valid Mongoose model:`, model);
    process.exit(1);
  }
}

// MongoDB connection
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/myhomebasics';

async function seedDatabase() {
  try {
    // Connect to MongoDB
    await mongoose.connect(MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('Connected to MongoDB');

    // Clear existing data
    await Promise.all([
      Product.deleteMany({}),
      Category.deleteMany({}),
      Testimonial.deleteMany({}),
      Promo.deleteMany({}),
      Newsletter.deleteMany({}),
    ]);
    console.log('Cleared existing data');

    // Seed Products
    await Product.insertMany([
      {
        name: 'Velvet Harmony Sofa',
        price: 29999.99,
        oldPrice: 34999.99,
        image: 'https://images.unsplash.com/photo-1555041469-a586c61ea9bc?auto=format&fit=crop&w=1170&q=80',
        description: 'Luxurious velvet sofa for ultimate comfort.',
        isFeatured: true,
      },
      {
        name: 'Modern Pendant Lamp',
        price: 49.99,
        image: 'https://images.unsplash.com/photo-1583847268964-b28dc8f51f92?auto=format&fit=crop&w=1170&q=80',
        description: 'Sleek modern lamp to brighten your space.',
        isFeatured: false,
      },
      {
        name: 'Boho Cushion Set',
        price: 29.99,
        image: 'https://images.unsplash.com/photo-1560448204-603b3fc33ddc?auto=format&fit=crop&w=1170&q=80',
        description: 'Vibrant boho cushions for a cozy touch.',
        isFeatured: true,
      },
    ]);
    console.log('Seeded products');

    // Seed Categories
    await Category.insertMany([
      {
        name: 'Furniture',
        image: 'https://images.unsplash.com/photo-1555041469-a586c61ea9bc?auto=format&fit=crop&w=1170&q=80',
      },
      {
        name: 'Lighting',
        image: 'https://images.unsplash.com/photo-1583847268964-b28dc8f51f92?auto=format&fit=crop&w=1170&q=80',
      },
      {
        name: 'Decor',
        image: 'https://images.unsplash.com/photo-1560448204-603b3fc33ddc?auto=format&fit=crop&w=1170&q=80',
      },
    ]);
    console.log('Seeded categories');

    // Seed Testimonials
    await Testimonial.insertMany([
      {
        name: 'Aisha Bello',
        image: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=100&q=80',
        rating: 5,
        text: 'The Velvet Harmony Sofa transformed my living room! The quality exceeded my expectations.',
      },
      {
        name: 'Chukwu Emeka',
        image: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=100&q=80',
        rating: 4.5,
        text: 'Fantastic customer service! The lighting I chose is perfect for my apartment.',
      },
      {
        name: 'Funmi Adeleke',
        image: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=100&q=80',
        rating: 4.5,
        text: 'The boho pillows add such a vibrant touch to my decor. Love them!',
      },
    ]);
    console.log('Seeded testimonials');

    // Seed Promos
    await Promo.insertMany([
      {
        title: 'Free Shipping Nationwide',
        description: 'On orders over ₦50,000',
        iconPath: 'M20 8h-3V4H3c-1.1 0-2 .9-2 2v11h2c0 1.66 1.34 3 3 3s3-1.34 3-3h6c0 1.66 1.34 3 3 3s3-1.34 3-3h2v-5l-3-4zM6 18.5c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm12 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zM3 12h10v-2H3v2z',
      },
      {
        title: 'Secure Payments',
        description: '100% secure checkout',
        iconPath: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-1-13h2v6h-2zm0 8h2v2h-2z',
      },
      {
        title: 'Quality Guaranteed',
        description: 'Premium materials & craftsmanship',
        iconPath: 'M12 2l-5.5 9h11L12 2zm0 3.84L13.93 9h-3.87L12 5.84zM17.5 13c-2.49 0-4.5 2.01-4.5 4.5s2.01 4.5 4.5 4.5 4.5-2.01 4.5-4.5-2.01-4.5-4.5-4.5zm0 7c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z',
      },
    ]);
    console.log('Seeded promos');

    // Seed Newsletters
    await Newsletter.insertMany([{ email: 'test@example.com' }]);
    console.log('Seeded newsletters');

    console.log('Database seeded successfully');
  } catch (error) {
    console.error('Error seeding database:', error);
  } finally {
    await mongoose.connection.close();
    console.log('MongoDB connection closed');
  }
}

// Run the seed function
seedDatabase();