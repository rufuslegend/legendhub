let gql = require("graphql");

module.exports.blockedIPs = {};
module.exports.trackers = {};
module.exports.isIPBlocked = function(ip) {
    if (module.exports.blockedIPs.hasOwnProperty(ip)) {
        if (new Date() < module.exports.blockedIPs[ip].date)
            return true;
        else
            delete module.exports.blockedIPs[ip];
    }

    return false;
};

module.exports.trackAttempt = function(trackingType, ip, maxPerDay, maxPerMinute, blockDuration) {
    if (!module.exports.trackers[trackingType])
        module.exports.trackers[trackingType] = {};

    if (!module.exports.trackers[trackingType][ip])
        module.exports.trackers[trackingType][ip] = [new Date()];
    else
        module.exports.trackers[trackingType][ip].push(new Date());

    let attemptsPerMinute = 0;
    let attemptsPerDay = 0;
    let now = new Date();
    for (let i = 0; i < module.exports.trackers[trackingType][ip].length; ++i) {
        if ((now - module.exports.trackers[trackingType][ip][i]) < 1000*60*60*24) {
            attemptsPerDay++;
            if ((now - module.exports.trackers[trackingType][ip][i]) < 1000*60*5) {
                attemptsPerMinute++;
            }
        }
        else {
            module.exports.trackers[trackingType][ip].splice(i, 1);
            i--;
        }

        if (attemptsPerDay >= maxPerDay ||
            attemptsPerMinute >= maxPerMinute) {
            let date = new Date();
            date.setSeconds(date.getSeconds() + blockDuration);
            module.exports.blockedIPs[ip] = date;
            return;
        }
    }
}

module.exports.trackRegister = function(ip) {
    module.exports.trackAttempt("register", ip, 1, 1, 60*60*24);
}

module.exports.trackLogin = function(ip) {
    module.exports.trackAttempt("login", ip, 3, 20, 300);
}

module.exports.trackPageUpdate = function(ip) {
    module.exports.trackAttempt("pageUpdate", ip, 5, 200, 60);
}

module.exports.postAsync = async function(query, ip) {
    let headers = {
        "Content-Type": "application/json"
    };
    if (ip)
        headers["x-forwarded-for"] = ip;

    const response = await fetch(`http://localhost:${process.env.PORT}/api`, {
        method: "POST",
        headers,
        body: JSON.stringify({query})
    });
    const body = await response.json();

    if (body.errors) {
        let error = new Error(body.errors[0].message);
        error.status = body.errors[0].code || body.errors[0].extensions?.code;
        throw error;
    }

    return body.data;
};

module.exports.handleNotifications = async function(authToken, notifications, objectType, objectId) {
    for (let i = 0; i < notifications.length; ++i) {
        if (notifications[i].objectType == objectType &&
            notifications[i].objectId == objectId) {
            notifications.splice(i, 1);
            --i;
        }
    }

    let query = `
    mutation {
        markNotificationAsRead(authToken:"${authToken}",objectType:"${objectType}",objectId:${objectId})
    }
    `;
    try {
        await module.exports.postAsync(query);
    }
    catch (e) {
        console.error(e);
    }
    return notifications;
};

/* Errors */
class NotFoundError extends gql.GraphQLError {
    constructor(message) {
        if (!message)
            message = "Not found.";
        super(message, {
            extensions: {
                code: 404
            }
        });
    }
}

class TooManyRequestsError extends gql.GraphQLError {
    constructor(message) {
        if (!message)
            message = "Too many requests.";
        super(message, {
            extensions: {
                code: 429
            }
        });
    }
}

class UnauthorizedError extends gql.GraphQLError {
    constructor(message) {
        if (!message)
            message = "Unauthorized.";
        super(message, {
            extensions: {
                code: 401
            }
        });
    }
}

module.exports.NotFoundError = NotFoundError;
module.exports.TooManyRequestsError = TooManyRequestsError;
module.exports.UnauthorizedError = UnauthorizedError;
