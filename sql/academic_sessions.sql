drop index if exists oneroster12.academicsessions_sourcedid;
drop materialized view if exists oneroster12.academicsessions;
--
create materialized view if not exists oneroster12.academicsessions as
with sessions as (
    select ses.*, sch.localEducationAgencyid 
    from edfi.session ses 
        join edfi.school sch
            on ses.schoolid = sch.schoolid
),
calendar_windows as (
    select 
        cd.schoolid,
        cd.schoolyear,
        cd.calendarcode,
        min(cd.date) as first_school_day,
        max(cd.date) as last_school_day,
        array_agg(distinct eventdescriptor.codevalue) as eventdescriptors
    from edfi.calendardate cd
    	join edfi.calendardatecalendarevent cdce
    		on cd.schoolid=cdce.schoolid
    			and cd.date=cdce.date
    			and cd.schoolyear=cdce.schoolyear
    			and cd.calendarcode=cdce.calendarcode
        join edfi.descriptor eventdescriptor
            on cdce.calendareventdescriptorid=eventdescriptor.descriptorid
        join edfi.descriptormapping mappedeventdescriptor
            on mappedeventdescriptor.value=eventdescriptor.codevalue
                and mappedeventdescriptor.namespace=eventdescriptor.namespace
                and mappedeventdescriptor.mappednamespace='uri://1edtech.org/oneroster12/CalendarEventDescriptor'
    where mappedeventdescriptor.mappedvalue = 'TRUE' -- IS a school/instructional day
    group by grouping sets (
        -- school level
        (cd.schoolid, cd.schoolyear),
        (cd.schoolid, cd.schoolyear, cd.calendarcode)
    )
),
summarize_school_year as (
    -- school years are designed to be global in oneroster,
    -- but do not necessarily have uniform start/end days 
    -- in the real world. 
    -- As a compromise, we define school years by district 
    -- and take the modal start/end day
    select 
        localEducationAgencyId,
        schoolyear,
        mode() within group (order by first_school_day) as first_school_day,
        mode() within group (order by last_school_day) as last_school_day
    from calendar_windows cal
    join edfi.school sch
        on cal.schoolid = sch.schoolid
    where calendarcode is null 
    group by 1,2
),
create_school_year as (
    select 
        md5(schoolyear::text) as "sourcedId",
        'active' as "status",
        null::date as "dateLastModified",
        concat(schoolyear - 1, '-', schoolyear) as "title",
        'schoolYear' as "type",
        first_school_day::date::text as "startDate",
        last_school_day::date::text as "endDate",
        null::json as "parent",
        -- need to include `children` here?
        schoolyear as "schoolYear",
        json_build_object(
            'edfi', json_build_object(
                'resource', 'schoolYearTypes',
                'naturalKey', json_build_object(
                    'schoolYear', schoolyear
                )
            )
        ) as metadata
    from summarize_school_year
),
sessions_formatted as (
    select  
        md5(concat(
            schoolid::varchar,
            '-', sessionname::varchar
        )) as "sourcedId", 
        'active' as "status",
        sessions.lastmodifieddate as "dateLastModified",
        termdescriptor.codeValue as "title",
        mappedtermdescriptor.mappedvalue as "type", 
        begindate::date::text as "startDate",
        enddate::date::text as "endDate",
        json_build_object(
            'href', concat('/academicSessions/', md5(schoolyear::text)),
            'sourcedId', md5(schoolyear::text),
            'type', 'academicSession' 
        ) as "parent",
        schoolyear::text as "schoolYear",
        json_build_object(
            'edfi', json_build_object(
                'resource', 'sessions',
                'naturalKey', json_build_object(
                    'schoolId', schoolid,
                    'sessionName', sessionname
                )
            )
        ) as metadata
    from sessions
        join edfi.descriptor termdescriptor
            on sessions.termDescriptorId = termdescriptor.descriptorid
        join edfi.descriptormapping mappedtermdescriptor
            on mappedtermdescriptor.value = termdescriptor.codevalue
                and mappedtermdescriptor.namespace = termdescriptor.namespace
                and mappedtermdescriptor.mappednamespace = 'uri://1edtech.org/oneroster12/TermDescriptor'
),
stacked as (
    select * from create_school_year 
    union all
    select * from sessions_formatted
)
-- property documentation at
-- https://www.imsglobal.org/sites/default/files/spec/oneroster/v1p2/rostering-restbinding/OneRosterv1p2RosteringService_RESTBindv1p0.html#Main6p4p2
select * from stacked;

-- Add an index so the materialized view can be refreshed _concurrently_:
create index if not exists academicsessions_sourcedid ON oneroster12.academicsessions ("sourcedId");