const mongoose = require('mongoose');
const Teamspace = require('./models/Teamspace');
mongoose.connect('mongodb://localhost:27017/mayvel_task').then(async () => {
  const ts = await Teamspace.find();
  console.log(ts);
  process.exit(0);
});
