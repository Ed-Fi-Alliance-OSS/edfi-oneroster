drop index if exists oneroster12.orgs_sourcedid;
drop materialized view if exists oneroster12.orgs;
--
create materialized view if not exists oneroster12.orgs as
with schools as (
    select
        school.*,
    	schoolOrg.*,
        school.localEducationAgencyId as leaId
    from edfi.school
        join edfi.educationOrganization schoolOrg
            on schoolOrg.educationOrganizationId = school.schoolId
),
leas as (
    select
        localEducationAgency.*,
        leaOrg.*,
        localEducationAgency.stateEducationAgencyId as seaId
    from edfi.localEducationAgency
        join edfi.educationOrganization leaOrg
            on leaOrg.educationOrganizationId = localEducationAgency.localEducationAgencyId
),
seas as (
    select
    	stateEducationAgency.*,
    	seaOrg.*
    from edfi.stateEducationAgency
    	join edfi.educationOrganization seaOrg
    		on seaOrg.educationOrganizationId = stateEducationAgency.stateEducationAgencyId
),
schools_formatted as (
    select
        md5(schools.schoolId::text) as "sourcedId", -- unique ID constructed from natural key of Ed-Fi Schools
        'active' as "status",
        lastmodifieddate as "dateLastModified",
        nameOfInstitution::text as "name",
        'school' as "type",
        schoolId::text as "identifier",
        case when leaId is not null then json_build_object(
            'href', concat('/orgs/', md5(leaId::text)),
            'sourcedId', md5(leaId::text),
            'type', 'org'
        ) else null end as "parent",
        null as "children",
        json_build_object(
            'edfi', json_build_object(
                'resource', 'schools',
                'naturalKey', json_build_object(
                    'schoolId', schoolId
                )
            )
        ) AS metadata
    from schools
),
leas_formatted as (
    select
        md5(leas.localEducationAgencyId::text) as "sourcedId", -- unique ID constructed from natural key of Ed-Fi LocalEducationAgencies
        'active' as "status",
        lastmodifieddate as "dateLastModified",
        nameOfInstitution::text as "name",
        'district' as "type",
        localEducationAgencyId::text as "identifier",
        case when stateEducationAgencyId is not null then json_build_object(
            'href', concat('/orgs/', md5(stateEducationAgencyId::text)),
            'sourcedId', md5(stateEducationAgencyId::text),
            'type', 'org'
        ) else null end as "parent",
        null as "children", -- need to include `children` here?
        json_build_object(
            'edfi', json_build_object(
                'resource', 'localEducationAgencies',
                'naturalKey', json_build_object(
                    'localEducationAgencyId', localEducationAgencyId
                )
            )
        ) AS metadata
    from leas
),
seas_formatted as (
    select
        md5(seas.stateEducationAgencyId::text) as "sourcedId", -- unique ID constructed from natural key of Ed-Fi StateEducationAgencies
        'active' as "status",
        lastmodifieddate as "dateLastModified",
        nameOfInstitution::text as "name",
        'state' as "type",
        stateEducationAgencyId::text as "identifier",
        null::json as "parent",
        null as "children", -- need to include `children` here?
        json_build_object(
            'edfi', json_build_object(
                'resource', 'stateEducationAgencies',
                'naturalKey', json_build_object(
                    'stateEducationAgencyId', stateEducationAgencyId
                )
            )
        ) AS metadata
    from seas
),
-- property documentation at
-- https://www.imsglobal.org/sites/default/files/spec/oneroster/v1p2/rostering-restbinding/OneRosterv1p2RosteringService_RESTBindv1p0.html#Main6p16p2
stacked as (
    select * from schools_formatted
        union all
    select * from leas_formatted
        union all 
    select * from seas_formatted
)
select * from stacked;

-- Add an index so the materialized view can be refreshed _concurrently_:
create index if not exists orgs_sourcedid ON oneroster12.orgs ("sourcedId");