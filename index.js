const axios = require('axios');
const {DateTime} = require('luxon');
const fs = require('fs').promises;
const querystring = require('querystring');
require('dotenv').config();

const foodNameRe = /<a.*<div style="float: left; width:50%">(.*?)<\/div>/s;

const days = ['Mandag', 'Tirsdag', 'Onsdag', 'Torsdag', 'Fredag', 'Lørdag', 'Søndag'];

function fetchFoodData() {
    /**
     * @type {Array.<{day: Number, raw: String}>}
     */
    const menuItems = [];

    const dailyMenuRe = /<li class="headline">(.|\n|\r)*?<\/a>/g;
    axios.default.post('https://www.shop.foodandco.dk/gf').then(res => {
        const data = res.data.slice(0, 20000);

        let m;
        let currentDay = 0;

        let today = DateTime.now();
        let monday = today.startOf('week');

        while ((m = dailyMenuRe.exec(data)) !== null) {
            // This is necessary to avoid infinite loops with zero-width matches
            if (m.index === dailyMenuRe.lastIndex) {
                dailyMenuRe.lastIndex++;
            }

            m.forEach((match, groupIndex) => {
                if (match.includes('product menu')) {
                    if (today.weekday > ++currentDay) return;
                    const foodName = match.match(foodNameRe)[1];
                    const day = monday.plus({days: currentDay - 1});

                    menuItems.push({
                        day: days[day.weekday - 1],
                        date: day.toISODate(),
                        foodName,
                    });
                }

            });
        }

        if (today.weekday !== 1) {
            let monday2 = monday.plus({days: 7});
            axios.default.post('https://www.shop.foodandco.dk/gf', {deliveryText: `week${monday2.toFormat('dd-MM-yyyy')}`}).then(res => {
                const data = res.data.slice(0, 20000);
                let m;
                let currentDay = 0;

                while (menuItems.length < 5 && (m = dailyMenuRe.exec(data)) !== null) {
                    // This is necessary to avoid infinite loops with zero-width matches
                    if (m.index === dailyMenuRe.lastIndex) {
                        dailyMenuRe.lastIndex++;
                    }

                    // The result can be accessed through the `m`-variable.
                    m.forEach((match, groupIndex) => {
                        if (match.includes('product menu')) {
                            const foodName = match.match(foodNameRe)[1];
                            const day = monday2.plus({days: currentDay++});

                            menuItems.push({
                                day: days[day.weekday - 1],
                                date: day.toISODate(),
                                foodName,
                            });
                        }

                    });
                }

                try {
                    fs.mkdir('../site/data', {recursive: true});
                } catch (e) {
                }
                fs.writeFile('../site/data/menu.json', JSON.stringify(menuItems, null, 4)).then(() => console.log('done'));
                fs.writeFile('../site/data/menu.js', `var menu = ${JSON.stringify(menuItems)}`).then(() => console.log('done'));
                console.log(menuItems);
                return;
            }).catch(console.error);
        }

        try {
            fs.mkdir('../site/data', {recursive: true});
        } catch (e) {
        }
        fs.writeFile('../site/data/menu.json', JSON.stringify(menuItems, null, 4)).then(() => console.log('done'));
        fs.writeFile('../site/data/menu.js', `var menu = ${JSON.stringify(menuItems)}`).then(() => console.log('done'));
        console.log(menuItems);

    }).catch(console.error);
}

fetchFoodData();
setInterval(fetchFoodData, 21600000);

async function getNetatmo() {
    try {
        try {
            fs.mkdir('./secret', {recursive: true});
        } catch (e) {
        }
        let netatmoCredentials = JSON.parse(await fs.readFile('./secret/netatmoCreddentials.json', {encoding: 'utf-8'}));

        const current_time = Date.now();

        if (netatmoCredentials.expires_at === undefined || current_time > netatmoCredentials.expires_at) {
            console.log('Refreshing netatmo...');

            const tokenResponse = await axios.post('https://api.netatmo.com/oauth2/token', querystring.stringify({
                grant_type: 'refresh_token',
                refresh_token: netatmoCredentials.refresh_token,
                client_id: process.env.NETATMO_CLIENT_ID,
                client_secret: process.env.NETATMO_CLIENT_SECRET,
            }), {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
            });

            netatmoCredentials = tokenResponse.data;

            netatmoCredentials.expires_at = Date.now() + (tokenResponse.data.expires_in * 1000);

            console.log(netatmoCredentials);

            await fs.writeFile('./secret/netatmoCreddentials.json', JSON.stringify(tokenResponse.data, null, 4));
        }

        const timestamp = getTimestampInSeconds() - 2700;
        const measureResponse = await axios.get(`https://api.netatmo.com/api/getmeasure?device_id=70:ee:50:83:f5:34&scale=30min&type=rain&module_id=05:00:00:0a:b3:90&optimize=true&date_begin=${timestamp}`, {
            headers: {
                'Authorization': `Bearer ${netatmoCredentials.access_token}`,
            },
        });

        const rainValue = measureResponse.data.body[0]?.value[0][0];
        console.log('rainValue', rainValue);

        try {
            fs.mkdir('../site/data', {recursive: true});
        } catch (e) {
        }
        fs.writeFile('../site/data/rain.json', JSON.stringify({rainValue: rainValue ?? 0})).then(() => console.log('rain done'));
    } catch (error) {
        console.log(error);
    }
}

getNetatmo();
setInterval(getNetatmo, 900000);

function getTimestampInSeconds() {
    return Math.floor(Date.now() / 1000);
}